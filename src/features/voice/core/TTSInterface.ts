import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { ProviderError, testWith } from '../../../core/http/errors';
import { providerOption, providerSecret } from './credentials';
import type { PreparedSpeech, SpeakOptions, TTSProvider, TTSProviderId, Voice } from './types';

/** เลขต่อท้ายชื่อไฟล์ — กันชื่อชนเมื่อเตรียมหลายประโยคในมิลลิวินาทีเดียว */
let fileSeq = 0;

function deleteQuietly(file: File): void {
  try {
    file.delete();
  } catch {
    // cache cleanup is best-effort
  }
}

/** Default speech language for the app. */
export const TTS_LANGUAGE = 'th-TH';

export function toGender(value: string | undefined): Voice['gender'] {
  const g = value?.toLowerCase();
  if (g === 'male' || g === 'female' || g === 'neutral') return g;
  return undefined;
}

export const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** SSML <prosody> attributes from SpeakOptions multipliers (1 = normal), or '' when unchanged. */
export function ssmlProsody(opts: SpeakOptions): string {
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  return [
    opts.speed != null && opts.speed !== 1 ? `rate="${pct(opts.speed)}"` : '',
    opts.pitch != null && opts.pitch !== 1 ? `pitch="${pct(opts.pitch)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface SynthesizedAudio {
  /** Raw bytes, or base64 when the API returns JSON-wrapped audio (e.g. Google). */
  data: Uint8Array | { base64: string };
  /** File extension the player should see, e.g. 'mp3'. */
  ext: string;
}

/**
 * Base for HTTP TTS providers: subclasses return audio from synthesize(); this class writes it to
 * the cache directory and plays it with expo-audio. speak() resolves when playback ends or stop() is called.
 */
export abstract class BaseCloudTTS implements TTSProvider {
  abstract readonly id: TTSProviderId;
  abstract readonly name: string;

  private player: AudioPlayer | null = null;
  private finish: (() => void) | null = null;
  /** Bumped by every speak()/stop(); a synthesize() that resolves after a newer call is dropped. */
  private runId = 0;

  protected abstract synthesize(text: string, opts: SpeakOptions): Promise<SynthesizedAudio>;
  protected abstract fetchVoices(): Promise<Voice[]>;
  /** Cheapest authenticated request that proves the credentials work. */
  protected probe(): Promise<unknown> {
    return this.fetchVoices();
  }

  async speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!text.trim()) return;
    this.stop();
    const currentRun = ++this.runId;
    const audio = await this.synthesize(text, opts);
    // stop() or a newer speak() ran while we were synthesizing: don't play stale audio
    if (currentRun !== this.runId) return;
    await this.playFile(this.writeAudio(audio));
  }

  /**
   * สังเคราะห์ + เขียนไฟล์ไว้ก่อน ยังไม่เล่น (ไม่แตะเสียงที่กำลังเล่นอยู่) — สตรีมเสียงใช้เตรียมประโยคถัดไป
   * ระหว่างที่ประโยคปัจจุบันยังพูด · `play()` ทีหลัง (stop() หยุดได้ตามปกติ) · ไม่ใช้ = `discard()`
   */
  async prepare(text: string, opts: SpeakOptions = {}): Promise<PreparedSpeech> {
    const file = this.writeAudio(await this.synthesize(text, opts));
    let used = false;
    return {
      play: () => {
        used = true;
        return this.playFile(file);
      },
      discard: () => {
        if (used) return;
        used = true;
        deleteQuietly(file);
      },
    };
  }

  private writeAudio(audio: SynthesizedAudio): File {
    const file = new File(Paths.cache, `tts-${this.id}-${Date.now()}-${fileSeq++}.${audio.ext}`);
    if (audio.data instanceof Uint8Array) file.write(audio.data);
    else file.write(audio.data.base64, { encoding: 'base64' });
    return file;
  }

  /** เล่นไฟล์ · resolve เมื่อจบหรือ stop() · ลบไฟล์เสมอ · เล่นไม่ได้ = reject (ให้ VoiceOrchestrator fallback) */
  private playFile(file: File): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const player = createAudioPlayer(file.uri);
      this.player = player;
      const cleanup = () => {
        sub.remove();
        player.remove();
        if (this.player === player) this.player = null;
        this.finish = null;
        deleteQuietly(file);
      };
      this.finish = () => {
        cleanup();
        resolve();
      };
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) this.finish?.();
      });
      try {
        player.play();
      } catch (e) {
        // Clean up without resolving, so the error reaches VoiceOrchestrator and it falls back
        cleanup();
        reject(new ProviderError(this.id, 'unsupported', `เล่นเสียงไม่ได้: ${String(e)}`));
      }
    });
  }

  stop(): void {
    this.runId++;
    this.player?.pause();
    this.finish?.();
  }

  getVoices(): Promise<Voice[]> {
    return this.fetchVoices();
  }

  testConnection(): Promise<{ ok: boolean; error?: string }> {
    return testWith(this.id, () => this.probe());
  }

  protected secret(field?: string): Promise<string> {
    return providerSecret('tts', this.id, field);
  }

  protected option(name: string, fallback?: string): Promise<string> {
    return providerOption('tts', this.id, name, fallback);
  }
}
