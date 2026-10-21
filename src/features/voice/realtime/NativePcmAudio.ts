/**
 * @file จับเสียงไมค์ / เล่นเสียงตอบเป็น PCM สตรีม ด้วย react-native-audio-api (native · lazy require)
 *
 * - ไมค์: 16 kHz mono ส่งเป็นก้อนเล็ก ~64 ms (ยิ่งก้อนเล็ก VAD ฝั่งเซิร์ฟเวอร์ยิ่งไว)
 * - ลำโพง: คิว buffer 24 kHz เล่นต่อเนื่อง · `clearBuffers()` ตัดเสียงที่ค้างทันทีตอนพูดแทรก
 * - **เสียงสะท้อน:** iOS ใช้โหมด `voiceChat` (มี AEC) → คุยพร้อมกันได้เต็ม · Android ไลบรารีไม่มี AEC →
 *   เล่นออกลำโพงมือถือ = ปิดไมค์ชั่วคราวระหว่างผู้ช่วยพูด (กันได้ยินเสียงตัวเองแล้วตอบวน) · ใส่หูฟัง/บลูทูธ = เปิดเต็ม
 */

import { Platform } from 'react-native';

import { ProviderError } from '../../../core/http/errors';
import {
  MIC_SAMPLE_RATE,
  PLAYBACK_SAMPLE_RATE,
  PlaybackClock,
  base64ToBytes,
  bytesToBase64,
  floatToPcm16Bytes,
  pcm16BytesToFloat,
} from './pcm';

type AudioApi = typeof import('react-native-audio-api');

export interface PcmAudio {
  /** เปิดไมค์ + ลำโพง · `onMic` รับก้อนเสียง PCM16 16 kHz แบบ base64 */
  start(onMic: (base64Pcm: string) => void): Promise<void>;
  /** ป้อนเสียงตอบ (PCM16 24 kHz base64) เข้าคิวเล่น */
  play(base64Pcm: string): void;
  /** ตัดเสียงที่ค้างคิวทันที */
  clearPlayback(): void;
  stop(): Promise<void>;
}

/** ปิดไมค์ต่อหลังเสียงตอบจบอีกเท่านี้ (ms) — เสียงก้องในห้อง/ลำโพงยังไม่หมด */
const HALF_DUPLEX_TAIL_MS = 350;
const MIC_BUFFER_SAMPLES = 1024;
const HEADSET_PATTERN = /head|bluetooth|blue|a2dp|sco|usb|wired|airpods|buds|earbud|earphone/i;
const BUILTIN_PATTERN = /speaker|receiver|built.?in/i;

function loadAudioApi(): AudioApi {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    return require('react-native-audio-api') as AudioApi;
  } catch {
    throw new ProviderError(
      'realtime',
      'unsupported',
      'เสียงสด Gemini ต้องใช้ development build (ไม่มี react-native-audio-api ในแอปนี้) — build ใหม่ด้วย expo run:android',
    );
  }
}

/** มี native module เสียงสตรีมใน build นี้ไหม */
export function isNativePcmAvailable(): boolean {
  try {
    loadAudioApi();
    return true;
  } catch {
    return false;
  }
}

export class NativePcmAudio implements PcmAudio {
  private api: AudioApi | null = null;
  private recorder: InstanceType<AudioApi['AudioRecorder']> | null = null;
  private context: InstanceType<AudioApi['AudioContext']> | null = null;
  private queue: ReturnType<
    InstanceType<AudioApi['AudioContext']>['createBufferQueueSource']
  > | null = null;
  private readonly clock = new PlaybackClock(PLAYBACK_SAMPLE_RATE);
  private halfDuplex = false;
  private running = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async start(onMic: (base64Pcm: string) => void): Promise<void> {
    const api = loadAudioApi();
    this.api = api;
    const { AudioContext, AudioRecorder, AudioManager } = api;

    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat', // เปิด AEC + AGC ของ iOS
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    });
    await AudioManager.setAudioSessionActivity(true);
    this.halfDuplex = await this.detectHalfDuplex(AudioManager);

    this.context = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    this.queue = this.context.createBufferQueueSource();
    this.queue.connect(this.context.destination);
    // ส่ง offset เอง: react-native-audio-api ตั้งค่าเริ่มต้น offset = -1 แล้วโยน RangeError ใส่ตัวเอง
    // ("offset must be a finite non-negative number: -1" — เสียงสด Gemini เริ่มไม่ได้ · Boss เจอ 2026-10-21)
    this.queue.start(0, 0);

    const recorder = new AudioRecorder();
    this.recorder = recorder;
    const attached = recorder.onAudioReady(
      { sampleRate: MIC_SAMPLE_RATE, bufferLength: MIC_BUFFER_SAMPLES, channelCount: 1 },
      ({ buffer }) => {
        if (!this.running) return;
        if (this.halfDuplex && this.clock.isActive(this.now(), HALF_DUPLEX_TAIL_MS)) return;
        onMic(bytesToBase64(floatToPcm16Bytes(buffer.getChannelData(0))));
      },
    );
    if (attached.status === 'error') {
      throw new ProviderError('realtime', 'server', `เปิดไมค์ไม่สำเร็จ: ${attached.message}`);
    }
    this.running = true;
    const started = await recorder.start();
    if (started.status === 'error') {
      this.running = false;
      throw new ProviderError('realtime', 'server', `เปิดไมค์ไม่สำเร็จ: ${started.message}`);
    }
  }

  play(base64Pcm: string): void {
    if (!this.context || !this.queue) return;
    const samples = pcm16BytesToFloat(base64ToBytes(base64Pcm));
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    this.queue.enqueueBuffer(buffer);
    this.clock.add(samples.length, this.now());
  }

  clearPlayback(): void {
    this.queue?.clearBuffers();
    this.clock.reset();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clock.reset();
    try {
      this.recorder?.clearOnAudioReady();
      await this.recorder?.stop();
    } catch (e) {
      console.error('[realtime] หยุดไมค์ไม่สำเร็จ', e);
    }
    try {
      this.queue?.stop();
      await this.context?.close();
      await this.api?.AudioManager.setAudioSessionActivity(false);
    } catch (e) {
      console.error('[realtime] ปิดเสียงไม่สำเร็จ', e);
    } finally {
      this.recorder = null;
      this.queue = null;
      this.context = null;
    }
  }

  /** iOS = full duplex (AEC) · Android: ออกลำโพงมือถือ = half duplex, หูฟัง/บลูทูธ = full */
  private async detectHalfDuplex(manager: AudioApi['AudioManager']): Promise<boolean> {
    if (Platform.OS === 'ios') return false;
    try {
      const info = await manager.getDevicesInfo();
      const outputs = info.currentOutputs.map((d) => `${d.category} ${d.name}`);
      const headset = outputs.some((o) => HEADSET_PATTERN.test(o) && !BUILTIN_PATTERN.test(o));
      return !headset;
    } catch {
      return true; // ไม่รู้เส้นทางเสียง → ถือว่าเป็นลำโพง (ปลอดภัยกว่า: ไม่วนตอบตัวเอง)
    }
  }
}
