/**
 * @file Gemini Live ผ่าน WebSocket (BidiGenerateContent) + เสียง PCM สตรีม
 *
 * ต่างจาก OpenAI (WebRTC): ต้องส่ง/รับเสียงเอง — ไมค์ 16 kHz PCM16 → base64 ใน `realtimeInput.audio`,
 * เสียงตอบ 24 kHz PCM16 base64 ใน `serverContent.modelTurn.parts[].inlineData` (ดู NativePcmAudio)
 *
 * - รุ่นเริ่มต้น `gemini-3.8-live` (ตั้งเองได้ที่ option `rt.gemini/model`)
 * - tool เป็น `NON_BLOCKING`: ระหว่างรอ `ask_atom` โมเดลยังพูดต่อได้ ("เดี๋ยวเช็กให้…") แล้วอ่านผลเมื่อมาถึง
 * - Gemini ส่ง transcript เป็นชิ้นย่อย ๆ → สะสมแล้วค่อยส่งต่อให้ session เมื่อจบเทิร์น
 * - ต่อสายใหม่อัตโนมัติด้วย session resumption เมื่อเซิร์ฟเวอร์ส่ง `goAway` / สายหลุดกลางทาง (อายุสาย ~10 นาที)
 * - ถ้าเซิร์ฟเวอร์ปฏิเสธ setup ที่มีตัวคุมต้นทุนเสริม (compression/resumption) → ลองใหม่แบบเรียบ
 */

import { ProviderError } from '../../../core/http/errors';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import { isRecord } from '../../../core/types/guards';
import { NativePcmAudio, isNativePcmAvailable, type PcmAudio } from './NativePcmAudio';
import { SpeakerGate } from '../speaker/gate';
import { createSpeakerGate } from '../speaker/SpeakerService';
import { utf8Decode } from './pcm';
import type { RealtimeConfig, RealtimeEvents, RealtimeProvider, RealtimeTransport } from './types';

const ID = 'realtime';
const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-3.8-live';
const SETUP_TIMEOUT_MS = 15_000;
const MAX_RECONNECTS = 3;
/** ถึงเท่านี้โทเคน บีบประวัติให้เหลือ TARGET — ไม่ต้องจ่ายค่า context ทั้งสายทุกเทิร์น */
export const COMPRESSION_TRIGGER_TOKENS = 12_000;
export const COMPRESSION_TARGET_TOKENS = 6_000;

/** เสียงต่อ persona (ชื่อเสียงของ Gemini Live) */
export const GEMINI_VOICE_BY_VOICE_NAME: Record<string, string> = {
  ash: 'Fenrir',
  cedar: 'Charon',
  marin: 'Kore',
  echo: 'Orus',
};

/** WebSocket ขั้นต่ำที่ใช้ (RN WebSocket ตรงกับนี้) */
export interface SocketLike {
  binaryType?: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface GeminiLiveDeps {
  audio?: () => PcmAudio;
  socket?: (url: string) => SocketLike;
  /** ตัวกรองเสียงเจ้าของ (null = ไม่กรอง) — ค่าเริ่มต้นอ่านจากการตั้งค่า ตั้งค่า › เสียง › เสียงของฉัน */
  gate?: (send: (base64Pcm: string) => void) => Promise<SpeakerGate | null>;
}

/** key ที่มีอยู่แล้วในแอป: key Gemini ของ AI → key Gemini TTS */
const KEY_CANDIDATES = [secretKey('ai', 'gemini'), secretKey('tts', 'gemini')] as const;

async function findKey(): Promise<string | null> {
  for (const name of KEY_CANDIDATES) {
    const value = await SecureKeyStore.get(name);
    if (value) return value;
  }
  return null;
}

/** setup message — extras = ตัวคุมต้นทุนเสริม (ตัดออกได้ถ้าเซิร์ฟเวอร์ไม่รับ) */
export function buildGeminiSetup(
  config: RealtimeConfig,
  model: string,
  opts: { extras: boolean; handle?: string | null },
): Record<string, unknown> {
  const voiceName = GEMINI_VOICE_BY_VOICE_NAME[config.voice] ?? 'Kore';
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
      systemInstruction: { parts: [{ text: config.instructions }] },
      tools: [
        {
          functionDeclarations: config.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            behavior: 'NON_BLOCKING',
          })),
        },
        // ค้นเว็บด้วย Google Search ของ Gemini เอง (ข่าว/ราคา/ข้อมูลสด) — ถ้าเซิร์ฟเวอร์ไม่รับ ตัวต่อลองใหม่แบบไม่มี extras
        ...(opts.extras ? [{ googleSearch: {} }] : []),
      ],
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          prefixPaddingMs: 100,
          silenceDurationMs: 500,
        },
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(opts.extras
        ? {
            contextWindowCompression: {
              triggerTokens: COMPRESSION_TRIGGER_TOKENS,
              slidingWindow: { targetTokens: COMPRESSION_TARGET_TOKENS },
            },
            sessionResumption: opts.handle ? { handle: opts.handle } : {},
          }
        : {}),
    },
  };
}

/** แปลง frame (string / ArrayBuffer / typed array) → object JSON · อ่านไม่ได้ = null */
export function parseFrame(data: unknown): Record<string, unknown> | null {
  let text: string;
  if (typeof data === 'string') text = data;
  else if (data instanceof ArrayBuffer) text = utf8Decode(new Uint8Array(data));
  else if (ArrayBuffer.isView(data))
    text = utf8Decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  else return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function closeError(code: number | undefined, reason: string | undefined): ProviderError {
  const text = reason?.trim() || `สายถูกปิด (code ${code ?? '?'})`;
  const kind = /API key|API_KEY|permission|PERMISSION_DENIED|unauthenticated|401|403/i.test(text)
    ? 'auth'
    : 'server';
  return new ProviderError(ID, kind, text);
}

export class GeminiLiveTransport implements RealtimeTransport {
  private socket: SocketLike | null = null;
  private audio: PcmAudio | null = null;
  private gate: SpeakerGate | null = null;
  private events: RealtimeEvents | null = null;
  private config: RealtimeConfig | null = null;
  private apiKey = '';
  private model = DEFAULT_GEMINI_LIVE_MODEL;
  private handle: string | null = null;
  private closing = false;
  private reconnects = 0;
  private extras = true;

  private readonly toolNames = new Map<string, string>();
  // สถานะของเทิร์นปัจจุบัน
  private inputText = '';
  private outputText = '';
  private userSpeaking = false;
  private responseStarted = false;
  private turnHadToolCall = false;

  constructor(private readonly deps: GeminiLiveDeps = {}) {}

  async connect(config: RealtimeConfig, events: RealtimeEvents): Promise<void> {
    const key = await findKey();
    if (!key) throw new ProviderError(ID, 'missing_key', 'ยังไม่ได้ตั้งค่า Gemini API key');
    this.apiKey = key;
    this.config = config;
    this.events = events;
    this.model =
      (await ProviderSettings.getOption('rt.gemini', 'model')) ?? DEFAULT_GEMINI_LIVE_MODEL;
    this.closing = false;
    this.reconnects = 0;
    this.extras = true;
    this.handle = null;
    this.resetTurn();

    try {
      await this.openSocket();
    } catch (e) {
      // setup ถูกปฏิเสธ: ลองใหม่แบบไม่มีตัวคุมต้นทุนเสริม (ไม่ใช่ปัญหา key / เครือข่าย)
      if (this.extras && e instanceof ProviderError && e.kind === 'server') {
        this.extras = false;
        await this.openSocket();
      } else {
        throw e;
      }
    }

    const audio = (this.deps.audio ?? (() => new NativePcmAudio()))();
    this.audio = audio;
    try {
      this.gate = await (this.deps.gate ?? createSpeakerGate)((chunk) => this.sendMic(chunk));
      await audio.start((chunk) => (this.gate ? this.gate.push(chunk) : this.sendMic(chunk)));
    } catch (e) {
      this.close();
      throw e;
    }
  }

  sendToolResult(callId: string, output: string): void {
    this.responseStarted = false; // เสียงถัดไปคือคำตอบรอบใหม่ (หลังได้ผล tool)
    this.send({
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            name: this.toolNames.get(callId) ?? 'ask_atom',
            response: { output },
            scheduling: 'WHEN_IDLE', // รอให้พูดประโยคเกริ่นจบก่อน แล้วค่อยอ่านผล
          },
        ],
      },
    });
    this.toolNames.delete(callId);
  }

  interrupt(): void {
    this.audio?.clearPlayback();
  }

  close(): void {
    this.closing = true;
    this.gate?.reset();
    this.gate = null;
    try {
      this.socket?.close();
    } catch (e) {
      console.error('[realtime] ปิด WebSocket ไม่สำเร็จ', e);
    }
    this.socket = null;
    void this.audio?.stop();
    this.audio = null;
    this.toolNames.clear();
  }

  // ---------- socket ----------

  /** เปิด WebSocket + ส่ง setup + รอ setupComplete */
  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${WS_BASE}?key=${encodeURIComponent(this.apiKey)}`;
      const ws = (this.deps.socket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(url);
      ws.binaryType = 'arraybuffer';
      this.socket = ws;
      let ready = false;
      const timer = setTimeout(() => {
        if (!ready) {
          reject(
            new ProviderError(
              ID,
              'timeout',
              `เชื่อมต่อ Gemini Live ไม่สำเร็จภายใน ${SETUP_TIMEOUT_MS / 1000}s`,
            ),
          );
          try {
            ws.close();
          } catch {
            // ปิดไม่ได้ก็ปล่อย
          }
        }
      }, SETUP_TIMEOUT_MS);

      ws.onopen = () => {
        if (this.config)
          this.send(
            buildGeminiSetup(this.config, this.model, { extras: this.extras, handle: this.handle }),
          );
      };
      ws.onmessage = (e) => {
        const msg = parseFrame(e.data);
        if (!msg) return;
        if (!ready && 'setupComplete' in msg) {
          ready = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        this.handleMessage(msg);
      };
      ws.onerror = () => {
        // รายละเอียดมากับ onclose — ที่นี่แค่กันเงียบ
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (!ready) {
          reject(closeError(e.code, e.reason));
          return;
        }
        if (ws === this.socket && !this.closing) this.onUnexpectedClose();
      };
    });
  }

  private send(message: Record<string, unknown>) {
    const ws = this.socket;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  private sendMic(base64Pcm: string) {
    this.send({ realtimeInput: { audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' } } });
  }

  /** สายหลุดกลางคุย: ต่อใหม่ด้วย resumption handle (ไมค์ไม่ต้องปิด) · ไม่ได้ = แจ้ง session ให้ตัดสาย */
  private onUnexpectedClose() {
    if (!this.handle || this.reconnects >= MAX_RECONNECTS) {
      this.events?.onClosed();
      return;
    }
    this.reconnects++;
    this.openSocket().catch(() => this.events?.onClosed());
  }

  // ---------- เหตุการณ์จากเซิร์ฟเวอร์ ----------

  private handleMessage(msg: Record<string, unknown>) {
    const events = this.events;
    if (!events) return;

    if (isRecord(msg.serverContent)) this.handleServerContent(msg.serverContent, events);

    if (isRecord(msg.toolCall) && Array.isArray(msg.toolCall.functionCalls)) {
      for (const call of msg.toolCall.functionCalls) {
        if (!isRecord(call) || typeof call.id !== 'string' || typeof call.name !== 'string')
          continue;
        this.toolNames.set(call.id, call.name);
        this.turnHadToolCall = true;
        events.onToolCall({
          callId: call.id,
          name: call.name,
          args: JSON.stringify(call.args ?? {}),
        });
      }
    }

    if (isRecord(msg.sessionResumptionUpdate)) {
      const { resumable, newHandle } = msg.sessionResumptionUpdate;
      if (resumable === true && typeof newHandle === 'string' && newHandle) this.handle = newHandle;
    }

    if (msg.goAway !== undefined && this.handle && !this.closing) {
      // เซิร์ฟเวอร์จะตัดสายเร็ว ๆ นี้ → ต่อสายใหม่ล่วงหน้าด้วย handle ล่าสุด
      const old = this.socket;
      this.reconnects++;
      this.openSocket()
        .then(() => {
          try {
            old?.close();
          } catch {
            // สายเก่าปิดไม่ได้ก็ปล่อย
          }
        })
        .catch(() => events.onClosed());
    }
  }

  private handleServerContent(content: Record<string, unknown>, events: RealtimeEvents) {
    if (
      isRecord(content.inputTranscription) &&
      typeof content.inputTranscription.text === 'string'
    ) {
      if (!this.userSpeaking) {
        this.userSpeaking = true;
        events.onSpeechStarted();
      }
      this.inputText += content.inputTranscription.text;
    }

    if (isRecord(content.modelTurn) && Array.isArray(content.modelTurn.parts)) {
      for (const part of content.modelTurn.parts) {
        const inline = isRecord(part) && isRecord(part.inlineData) ? part.inlineData : null;
        if (!inline || typeof inline.data !== 'string') continue;
        if (!this.responseStarted) this.startResponse(events);
        this.audio?.play(inline.data);
      }
    }

    if (
      isRecord(content.outputTranscription) &&
      typeof content.outputTranscription.text === 'string'
    ) {
      this.outputText += content.outputTranscription.text;
    }

    if (content.interrupted === true) {
      this.audio?.clearPlayback();
      if (this.responseStarted) this.finishResponse(events);
      this.resetTurn();
      events.onSpeechStarted();
      return;
    }

    if (content.turnComplete === true) {
      // เทิร์นที่ไม่มีเสียงตอบเลย (เช่น โมเดลเรียก tool อย่างเดียว) ยังต้องเก็บ transcript ฝั่งผู้ใช้
      if (!this.responseStarted && !this.turnHadToolCall && this.inputText.trim()) {
        this.startResponse(events);
      }
      if (this.responseStarted) this.finishResponse(events);
      this.resetTurn();
    }
  }

  /** เริ่มคำตอบ: แจ้ง session ก่อน แล้วค่อยส่ง transcript ผู้ใช้ (ลำดับนี้กัน transcript ลงแชทซ้ำตอน delegate) */
  private startResponse(events: RealtimeEvents) {
    this.responseStarted = true;
    events.onResponseStarted();
    const user = this.inputText.trim();
    if (user) events.onUserTranscript(user);
    this.inputText = '';
  }

  private finishResponse(events: RealtimeEvents) {
    const assistant = this.outputText.trim();
    if (assistant) events.onAssistantTranscript(assistant);
    events.onResponseDone({ hadToolCall: false });
  }

  private resetTurn() {
    this.inputText = '';
    this.outputText = '';
    this.userSpeaking = false;
    this.responseStarted = false;
    this.turnHadToolCall = false;
  }
}

export const geminiLiveProvider: RealtimeProvider = {
  id: 'gemini',
  name: 'Gemini Live',
  createTransport: () => new GeminiLiveTransport(),
  isConfigured: async () => isNativePcmAvailable() && (await findKey()) !== null,
};
