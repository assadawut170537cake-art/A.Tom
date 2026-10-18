/**
 * @file AI Orchestrator — เลือก LLM provider และ fallback อัตโนมัติ
 *
 * ลำดับการลอง: pinned → lastGood (sticky) → priority ของบอส → ลำดับลงทะเบียน
 * (เฉพาะ provider ที่เปิดอยู่และ `purpose = 'llm'` — Jev ไม่อยู่ในสายนี้)
 *
 * | error                                   | retry ตัวเดิม | fallback |
 * |-----------------------------------------|:------------:|:--------:|
 * | 429 / 5xx / timeout / network           | ✅ (ตาม Advanced) | ✅ |
 * | 401 / 403 (auth), ไม่มี key, unsupported | ❌           | ✅ |
 * | 400 อื่น ๆ, ตอบกลับผิดรูปแบบ              | ❌           | ❌ (โยนทันที) |
 *
 * key ที่ถูกปฏิเสธระหว่างที่ตัวถัดไปตอบได้ จะเก็บไว้ให้ `takeNotices()` เพื่อแจ้งบอส
 * ล้มทุกตัว → ProviderError เดียวที่รวมสาเหตุของทุกเจ้า
 *
 * `aiOrchestrator` คือ instance ที่แอปใช้ร่วมกัน · test สร้าง `new Orchestrator(registry, settings)` เอง
 *
 * @see ../../../../docs/ARCHITECTURE.md — หัวข้อ 4 Orchestrator pattern
 * @see ../../../../docs/DECISIONS.md — ADR-007 AI fallback chain แบบ sticky
 */

import {
  ProviderError,
  commonKind,
  toProviderError,
  userAdvice,
  type ProviderErrorKind,
} from '../../../core/http/errors';
import { sleep } from '../../../core/http/request';
import {
  ProviderSettings,
  type ProviderSettingsStore,
} from '../../../core/storage/ProviderSettings';
import { aiRegistry, type ProviderRegistry } from './ProviderRegistry';
import type { AIProvider, AIProviderId, ChatRequest, ChatResponse, PartialTextListener } from './types';

/** Failures worth retrying on the same provider (auth/missing key never fix themselves). */
const RETRYABLE = new Set<ProviderErrorKind>(['rate_limit', 'server', 'timeout', 'network']);
const RETRY_DELAY_MS = 800;

interface OrchestratorChatInput extends Omit<ChatRequest, 'model'> {
  /** Pin a provider; it is tried first, the rest of the chain is still used as fallback. */
  providerId?: AIProviderId;
  /** Model override for the pinned provider only (models are provider-specific). */
  model?: string;
  /**
   * มี = อยากได้คำตอบแบบไหล (ถ้าบอสเปิด streaming และ provider รองรับ)
   * ก่อนลอง provider ตัวถัดไปจะเรียก `onText('')` ให้ UI ล้างข้อความครึ่งทางของตัวที่ล้ม
   */
  onText?: PartialTextListener | undefined;
}

/**
 * Routes chat requests across LLM providers in priority order:
 * last successful provider → user priority (ProviderSettings) → registration order.
 * Falls back on 401/403/429/5xx/timeout/network/missing key; other errors (e.g. 400) are thrown.
 * 401/403 are never retried; when a later provider answers, the rejected key is kept for
 * takeNotices() so the user still learns it needs fixing.
 * Advanced settings: timeoutMs per request, retries on the same provider, fallback on/off.
 */
export class Orchestrator {
  private lastGood: AIProviderId | null = null;
  /** Rejected keys (401/403) that fallback hid behind a successful reply; see takeNotices(). */
  private readonly notices = new Set<string>();

  constructor(
    private readonly registry: ProviderRegistry = aiRegistry,
    private readonly settings: ProviderSettingsStore = ProviderSettings
  ) {}

  async chat(input: OrchestratorChatInput): Promise<ChatResponse> {
    const { providerId: pinned, model: pinnedModel, onText, webSearch, ...rest } = input;
    const chain = await this.providerChain(pinned);
    if (!chain.length) {
      throw new ProviderError('orchestrator', 'missing_key', 'ไม่มีผู้ให้บริการ AI ที่เปิดใช้งาน');
    }

    const adv = await this.settings.getAdvanced();
    const { timeoutMs, retries, fallback } = adv;
    const failures: ProviderError[] = [];
    let emitted = false;
    const listener: PartialTextListener | undefined = onText
      ? (text) => {
          emitted = text.length > 0;
          onText(text);
        }
      : undefined;
    for (const provider of fallback ? chain : chain.slice(0, 1)) {
      const id = provider.config.id;
      const model =
        (id === pinned && pinnedModel) ||
        (await this.settings.getModelFor(id)) ||
        provider.config.defaultModel;
      // ค้นเว็บ: Gemini ใช้โควตาฟรี (webSearch) · ตัวอื่นคิดเงินเพิ่ม (webSearchPaid)
      const search = !!webSearch && (provider.config.type === 'gemini' ? adv.webSearch : adv.webSearchPaid);
      const req: ChatRequest = { timeoutMs, ...rest, model, webSearch: search };
      for (let attempt = 0; ; attempt++) {
        if (emitted) listener?.('');
        try {
          const res =
            listener && adv.streaming && provider.chatStream
              ? await provider.chatStream(req, listener)
              : await provider.chat(req);
          this.lastGood = id;
          this.rememberAuthFailures(failures);
          return res;
        } catch (e) {
          const err = toProviderError(id, e);
          if (!err.shouldFallback) throw err;
          if (attempt < retries && RETRYABLE.has(err.kind)) {
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          if (this.lastGood === id) this.lastGood = null;
          failures.push(err);
          break;
        }
      }
    }
    throw new ProviderError(
      'orchestrator',
      commonKind(failures),
      `ผู้ให้บริการทุกรายล้มเหลว:\n${failures.map((f) => f.message).join('\n')}`
    );
  }

  /**
   * Warnings about keys that were rejected while another provider answered, collected across every
   * call (chat and intent classification alike) since the last take. Returned once, then cleared.
   */
  takeNotices(): string[] {
    const list = [...this.notices];
    this.notices.clear();
    return list;
  }

  private rememberAuthFailures(failures: ProviderError[]): void {
    for (const f of failures) {
      if (f.kind === 'auth') this.notices.add(`${f.message} — ${userAdvice('auth')}`);
    }
  }

  /** First provider that would be tried right now, or undefined if none is enabled. */
  async pickProvider(): Promise<AIProvider | undefined> {
    return (await this.providerChain())[0];
  }

  private async providerChain(pinned?: AIProviderId): Promise<AIProvider[]> {
    const all = this.registry.list().filter((p) => (p.config.purpose ?? 'llm') === 'llm');
    const enabled: AIProvider[] = [];
    for (const p of all) {
      const override = await this.settings.getEnabled(p.config.id);
      if (override ?? p.config.enabled) enabled.push(p);
    }

    const priority = await this.settings.getPriority();
    const rank = (id: AIProviderId) => {
      if (id === pinned) return -2;
      if (id === this.lastGood) return -1;
      const i = priority.indexOf(id);
      return i === -1 ? priority.length + all.findIndex((p) => p.config.id === id) : i;
    };
    return enabled.sort((a, b) => rank(a.config.id) - rank(b.config.id));
  }
}

export const aiOrchestrator = new Orchestrator();
