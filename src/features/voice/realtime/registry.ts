/**
 * @file เลือกผู้ให้บริการเสียงสด + transport ที่เลือกผู้ให้บริการตอนต่อสาย
 *
 * `live.provider`: `auto` (ค่าเริ่มต้น) = Gemini Live ก่อน (ใช้ key Gemini ที่แอปมีอยู่แล้ว · ราคาเสียงถูกกว่า)
 * ไม่พร้อมก็ OpenAI Realtime · `gemini` / `openai` = บังคับ (ขาด key / native → ขึ้น error ที่บอกทางแก้)
 */

import { ProviderError } from '../../../core/http/errors';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { geminiLiveProvider } from './GeminiLiveTransport';
import { openAIRealtimeProvider } from './OpenAIRealtimeTransport';
import type { RealtimeConfig, RealtimeEvents, RealtimeProvider, RealtimeTransport } from './types';

export type RealtimePreference = 'auto' | 'gemini' | 'openai';

/** ลำดับ auto */
export const REALTIME_PROVIDERS: readonly RealtimeProvider[] = [
  geminiLiveProvider,
  openAIRealtimeProvider,
];

async function readPreference(): Promise<RealtimePreference> {
  const value = await ProviderSettings.getOption('live', 'provider');
  return value === 'gemini' || value === 'openai' ? value : 'auto';
}

/** null = ไม่มีเจ้าไหนพร้อม (auto) */
export async function pickRealtimeProvider(
  preference?: RealtimePreference,
  providers: readonly RealtimeProvider[] = REALTIME_PROVIDERS,
): Promise<RealtimeProvider | null> {
  const pref = preference ?? (await readPreference());
  if (pref !== 'auto') return providers.find((p) => p.id === pref) ?? null;
  for (const provider of providers) {
    if (await provider.isConfigured()) return provider;
  }
  return null;
}

/** transport ที่ตัดสินใจเลือกเจ้าตอน connect (session ถือ instance เดียวตลอด) */
export class RoutedTransport implements RealtimeTransport {
  private inner: RealtimeTransport | null = null;

  constructor(
    private readonly pick: () => Promise<RealtimeProvider | null> = () => pickRealtimeProvider(),
  ) {}

  async connect(config: RealtimeConfig, events: RealtimeEvents): Promise<void> {
    const provider = await this.pick();
    if (!provider)
      throw new ProviderError('realtime', 'missing_key', 'ไม่มีผู้ให้บริการเสียงสดที่พร้อมใช้งาน');
    const transport = provider.createTransport();
    this.inner = transport;
    await transport.connect(config, events);
  }

  sendToolResult(callId: string, output: string): void {
    this.inner?.sendToolResult(callId, output);
  }

  interrupt(): void {
    this.inner?.interrupt();
  }

  close(): void {
    this.inner?.close();
    this.inner = null;
  }
}
