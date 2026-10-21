/**
 * @file OpenAI Realtime ผ่าน WebRTC (react-native-webrtc)
 *
 * เสียงเดินเป็น media track ตรงมือถือ ↔ OpenAI (ไม่ต้อง encode PCM/base64 เอง · echo cancellation และ
 * jitter buffer ของ WebRTC ทำงานให้) · event (JSON) วิ่งบน data channel `oai-events`
 * ขั้นตอน: mint ephemeral key → สร้าง peer + ต่อไมค์ → POST SDP offer → รับ SDP answer
 *
 * react-native-webrtc เป็น native module — โหลดแบบ lazy (`require` ตอน connect) เพื่อให้แอปเปิดใน
 * Expo Go / jest ได้ · ไม่มี native module = ProviderError `unsupported` ให้ UI ตกไปใช้โหมดอัดไฟล์เดิม
 */

import { ProviderError } from '../../../core/http/errors';
import { request, requestJson } from '../../../core/http/request';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import { isRecord } from '../../../core/types/guards';
import type { RealtimeConfig, RealtimeEvents, RealtimeProvider, RealtimeTransport } from './types';

const ID = 'realtime';
const API = 'https://api.openai.com/v1';
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
export const REALTIME_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
/** คำตอบเสียงยาวสุดต่อเทิร์น (โทเคนเสียงขาออกแพงที่สุด) — เกินนี้โมเดลถูกตัด */
export const MAX_OUTPUT_TOKENS = 600;
/** เก็บ context ของบทสนทนาไว้ครึ่งหนึ่งเมื่อยาวเกิน — ไม่ให้ทุกเทิร์นจ่ายค่า history ทั้งสาย */
export const TRUNCATION_RETENTION_RATIO = 0.5;
const CONNECT_TIMEOUT_MS = 15_000;

/** key ที่มีอยู่แล้วในแอป: key เสียงสดโดยเฉพาะ → OpenAI TTS → Whisper (STT) */
const KEY_CANDIDATES = [
  secretKey('tts', 'openai', 'realtime'),
  secretKey('tts', 'openai'),
  secretKey('stt', 'whisper'),
] as const;

async function findKey(): Promise<string | null> {
  for (const name of KEY_CANDIDATES) {
    const value = await SecureKeyStore.get(name);
    if (value) return value;
  }
  return null;
}

/** session ที่ส่งตอน mint key — กำหนดทุกอย่างตั้งแต่ต้น ไม่ต้องส่ง session.update ตามหลัง */
export function buildSessionBody(
  config: RealtimeConfig,
  model: string,
  withExtras: boolean,
): Record<string, unknown> {
  return {
    type: 'realtime',
    model,
    instructions: config.instructions,
    output_modalities: ['audio'],
    audio: {
      input: {
        transcription: { model: REALTIME_TRANSCRIBE_MODEL, language: 'th' },
        noise_reduction: { type: 'near_field' },
        // server VAD (ไม่ใช้ semantic_vad): ค่าเงียบที่แน่นอนกว่าสำหรับภาษาไทยที่ไม่มีช่องว่างระหว่างคำ
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: config.voice },
    },
    tools: config.tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    tool_choice: 'auto',
    // ตัวคุมต้นทุน — ถ้าเซิร์ฟเวอร์ไม่รับ field พวกนี้ ตัวต่อจะลองใหม่โดยไม่ใส่ (ดู mintKey)
    ...(withExtras
      ? {
          max_output_tokens: MAX_OUTPUT_TOKENS,
          truncation: { type: 'retention_ratio', retention_ratio: TRUNCATION_RETENTION_RATIO },
        }
      : {}),
  };
}

async function mintKey(apiKey: string, config: RealtimeConfig, model: string): Promise<string> {
  const call = (withExtras: boolean) =>
    requestJson<unknown>(ID, `${API}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: buildSessionBody(config, model, withExtras) }),
      timeoutMs: 15_000,
    });
  let data: unknown;
  try {
    data = await call(true);
  } catch (e) {
    // 400 = field เสริมไม่รองรับในรุ่นนี้ → ลองใหม่แบบเรียบ (auth / network ไม่ retry)
    if (e instanceof ProviderError && e.kind === 'bad_request') data = await call(false);
    else throw e;
  }
  const value = isRecord(data) ? data.value : undefined;
  if (typeof value !== 'string' || !value) {
    throw new ProviderError(ID, 'server', 'OpenAI ไม่ส่ง ephemeral key กลับมา');
  }
  return value;
}

/** ชนิดขั้นต่ำของ react-native-webrtc ที่ใช้ (กัน type หลวมจาก require แบบ lazy) */
interface WebRTCModule {
  RTCPeerConnection: new (config?: unknown) => PeerLike;
  mediaDevices: { getUserMedia(c: unknown): Promise<StreamLike> };
}
interface TrackLike {
  stop(): void;
}
interface StreamLike {
  getTracks(): TrackLike[];
}
interface ChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, fn: (e: { data?: unknown }) => void): void;
}
interface PeerLike {
  connectionState: string;
  addTrack(track: TrackLike, stream: StreamLike): unknown;
  createDataChannel(label: string): ChannelLike;
  createOffer(opts?: unknown): Promise<{ sdp?: string; type: string }>;
  setLocalDescription(d: unknown): Promise<void>;
  setRemoteDescription(d: unknown): Promise<void>;
  addEventListener(type: string, fn: () => void): void;
  close(): void;
}

function loadWebRTC(): WebRTCModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    return require('react-native-webrtc') as WebRTCModule;
  } catch {
    throw new ProviderError(
      ID,
      'unsupported',
      'เสียงสดต้องใช้ development build (ไม่มี react-native-webrtc ในแอปนี้) — build ใหม่ด้วย expo run:android',
    );
  }
}

/** มี native module react-native-webrtc ใน build นี้ไหม (Expo Go / jest = ไม่มี) */
export function isWebRTCAvailable(): boolean {
  try {
    loadWebRTC();
    return true;
  } catch {
    return false;
  }
}

export class OpenAIRealtimeTransport implements RealtimeTransport {
  private pc: PeerLike | null = null;
  private dc: ChannelLike | null = null;
  private stream: StreamLike | null = null;
  private closed = false;

  async connect(config: RealtimeConfig, events: RealtimeEvents): Promise<void> {
    const apiKey = await findKey();
    if (!apiKey) throw new ProviderError(ID, 'missing_key', 'ยังไม่ได้ตั้งค่า OpenAI API key');
    const { RTCPeerConnection, mediaDevices } = loadWebRTC();
    const model =
      (await ProviderSettings.getOption('rt.openai', 'model')) ?? DEFAULT_REALTIME_MODEL;
    const ephemeral = await mintKey(apiKey, config, model);

    this.closed = false;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    // ตัดเสียงสะท้อน/เสียงรบกวนที่ต้นทาง — ไม่งั้นไมค์ได้ยินเสียงตัวเองแล้วตอบวน (โหมดเก่าแก้ด้วยการไม่อัดตอนพูด)
    const stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.stream = stream;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.addEventListener('message', (e) => {
      if (typeof e.data === 'string') this.dispatch(e.data, events);
    });
    pc.addEventListener('connectionstatechange', () => {
      if (!this.closed && ['failed', 'disconnected', 'closed'].includes(pc.connectionState))
        events.onClosed();
    });

    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new ProviderError(
              ID,
              'timeout',
              `เชื่อมต่อเสียงสดไม่สำเร็จภายใน ${CONNECT_TIMEOUT_MS / 1000}s`,
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );
      dc.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    const res = await request(ID, `${API}/realtime/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp ?? '',
      timeoutMs: CONNECT_TIMEOUT_MS,
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    try {
      await opened;
    } catch (e) {
      this.close();
      throw e;
    }
  }

  sendToolResult(callId: string, output: string): void {
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    });
    this.send({ type: 'response.create' });
  }

  interrupt(): void {
    this.send({ type: 'response.cancel' });
    // WebRTC: ล้างเสียงที่ค้างในบัฟเฟอร์ฝั่งเครื่อง ไม่งั้นพูดต่ออีกครู่หลังตัด
    this.send({ type: 'output_audio_buffer.clear' });
  }

  close(): void {
    this.closed = true;
    try {
      this.dc?.close();
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      this.pc?.close();
    } catch (e) {
      console.error('[realtime] ปิด WebRTC ไม่สำเร็จ', e);
    } finally {
      this.dc = null;
      this.pc = null;
      this.stream = null;
    }
  }

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  /** แปลง event ของ OpenAI → RealtimeEvents (ไม่รู้จัก = ข้าม) */
  private dispatch(raw: string, events: RealtimeEvents) {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(msg) || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'input_audio_buffer.speech_started':
        events.onSpeechStarted();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof msg.transcript === 'string') events.onUserTranscript(msg.transcript);
        break;
      case 'response.created':
        events.onResponseStarted();
        break;
      case 'response.output_audio_transcript.done':
        if (typeof msg.transcript === 'string') events.onAssistantTranscript(msg.transcript);
        break;
      case 'response.done':
        this.handleResponseDone(msg.response, events);
        break;
      case 'error': {
        const detail = isRecord(msg.error) ? msg.error : msg;
        const text =
          typeof detail.message === 'string' ? detail.message : 'ข้อผิดพลาดจาก OpenAI Realtime';
        events.onError(new ProviderError(ID, 'server', text));
        break;
      }
      default:
        break;
    }
  }

  private handleResponseDone(response: unknown, events: RealtimeEvents) {
    const output = isRecord(response) && Array.isArray(response.output) ? response.output : [];
    let hadToolCall = false;
    for (const item of output) {
      if (!isRecord(item) || item.type !== 'function_call') continue;
      if (typeof item.call_id !== 'string' || typeof item.name !== 'string') continue;
      hadToolCall = true;
      events.onToolCall({
        callId: item.call_id,
        name: item.name,
        args: typeof item.arguments === 'string' ? item.arguments : '{}',
      });
    }
    events.onResponseDone({ hadToolCall });
  }
}

export const openAIRealtimeProvider: RealtimeProvider = {
  id: 'openai',
  name: 'OpenAI Realtime',
  createTransport: () => new OpenAIRealtimeTransport(),
  isConfigured: async () => isWebRTCAvailable() && (await findKey()) !== null,
};
