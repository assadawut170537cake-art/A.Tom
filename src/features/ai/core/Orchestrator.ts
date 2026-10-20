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
 * โควต้าหมด (429 + "quota") → พักโมเดลนั้นไว้ (QuotaGuard) แล้วลองรุ่นสำรองของเจ้าเดียวกัน
 * (`quotaFallbackModels` — โควต้าฟรีนับแยกต่อโมเดล) ก่อนไปเจ้าถัดไป · ADR-017
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
import { QuotaGuard, isQuotaError } from './QuotaGuard';
import type {
  AIProvider,
  AIProviderConfig,
  AIProviderId,
  ChatRequest,
  ChatResponse,
} from './types';

/** Failures worth retrying on the same provider (auth/missing key never fix themselves). */
const RETRYABLE = new Set<ProviderErrorKind>(['rate_limit', 'server', 'timeout', 'network']);
const RETRY_DELAY_MS = 800;

interface Plan {
  provider: AIProvider;
  /** [ตัวที่บอสเลือก, ...รุ่นสำรองเมื่อโควต้าหมด] */
  models: string[];
}

/** ตัวที่เลือกก่อนเสมอ แล้วตามด้วยรุ่นสำรอง (ไม่ซ้ำ) */
function modelsToTry(config: AIProviderConfig, preferred: string): string[] {
  return [preferred, ...(config.quotaFallbackModels ?? []).filter((m) => m !== preferred)];
}

interface OrchestratorChatInput extends Omit<ChatRequest, 'model'> {
  /** Pin a provider; it is tried first, the rest of the chain is still used as fallback. */
  providerId?: AIProviderId;
  /** Model override for the pinned provider only (models are provider-specific). */
  model?: string;
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
    private readonly settings: ProviderSettingsStore = ProviderSettings,
    private readonly quota: QuotaGuard = new QuotaGuard(),
  ) {}

  async chat(input: OrchestratorChatInput): Promise<ChatResponse> {
    return this.run(input, (provider, req) => provider.chat(req));
  }

  /**
   * เหมือน chat แต่ส่งข้อความทีละท่อนให้ `onDelta` ระหว่างที่โมเดลยังพิมพ์ (เจ้าที่ไม่มี chatStream = ส่งทั้งก้อนครั้งเดียว)
   * retry / fallback / สลับรุ่นได้ **เฉพาะก่อนเริ่มส่งข้อความ** — ส่งไปแล้ว (บอสเริ่มได้ยินแล้ว) ถ้าสายหลุด
   * = คืนเท่าที่ได้ ไม่เริ่มใหม่ (ไม่งั้นพูดซ้ำ/ปนสองเจ้า)
   */
  async chatStream(
    input: OrchestratorChatInput,
    onDelta: (text: string) => void,
  ): Promise<ChatResponse> {
    let emitted = '';
    const emit = (text: string) => {
      emitted += text;
      onDelta(text);
    };
    return this.run(input, async (provider, req) => {
      if (!provider.chatStream) {
        const res = await provider.chat(req);
        emit(res.content);
        return res;
      }
      try {
        return await provider.chatStream(req, emit);
      } catch (e) {
        if (!emitted.trim()) throw e; // ยังไม่ได้ส่งอะไร → ให้ retry/fallback ตามปกติ
        console.error('[ai] คำตอบขาดกลางคัน — ใช้เท่าที่ได้', e);
        // บอกบอสว่าคำตอบนี้ไม่ครบ (ไม่งั้นดูเหมือนตอบจบปกติ)
        const kind = toProviderError(provider.config.id, e).kind;
        this.notices.add(
          `${provider.config.name}: คำตอบขาดกลางคัน (${kind}) — ข้อความที่ได้อาจไม่ครบ ลองถามใหม่ได้`,
        );
        return { content: emitted.trim(), model: req.model, providerId: provider.config.id };
      }
    });
  }

  private async run(
    input: OrchestratorChatInput,
    call: (provider: AIProvider, req: ChatRequest) => Promise<ChatResponse>,
  ): Promise<ChatResponse> {
    const { providerId: pinned, model: pinnedModel, ...rest } = input;
    const chain = await this.providerChain(pinned);
    if (!chain.length) {
      throw new ProviderError('orchestrator', 'missing_key', 'ไม่มีผู้ให้บริการ AI ที่เปิดใช้งาน');
    }

    const { timeoutMs, retries, fallback } = await this.settings.getAdvanced();
    const plans: Plan[] = [];
    for (const provider of fallback ? chain : chain.slice(0, 1)) {
      const id = provider.config.id;
      const preferred =
        (id === pinned && pinnedModel) ||
        (await this.settings.getModelFor(id)) ||
        provider.config.defaultModel;
      plans.push({ provider, models: modelsToTry(provider.config, preferred) });
    }
    // ทุกตัวพักอยู่ = ลองตามปกติ (ดีกว่าตอบล้มโดยไม่ได้ลองสักตัว)
    const ignoreCooldown = plans.every(({ provider, models }) =>
      models.every((m) => this.quota.isCooling(provider.config.id, m)),
    );

    const failures: ProviderError[] = [];
    for (const plan of plans) {
      const res = await this.tryProvider(
        plan,
        { timeoutMs, ...rest },
        retries,
        ignoreCooldown,
        failures,
        call,
      );
      if (res) {
        // ตัวที่ถูกระบุ (เช่นโมเดลประจำ persona) ไม่นับเป็น lastGood — ไม่งั้น persona ที่ตั้ง "อัตโนมัติ" ลากไปใช้ตาม
        if (plan.provider.config.id !== pinned) this.lastGood = plan.provider.config.id;
        this.rememberAuthFailures(failures);
        return res;
      }
    }
    throw new ProviderError(
      'orchestrator',
      commonKind(failures),
      `ผู้ให้บริการทุกรายล้มเหลว:\n${failures.map((f) => f.message).join('\n')}`,
    );
  }

  /**
   * ลองโมเดลของ provider นี้ตามลำดับ: ตัวที่บอสเลือก → รุ่นสำรองใน `quotaFallbackModels`
   * - โควต้าหมด → พักโมเดลนั้น (QuotaGuard) แล้วลองรุ่นถัดไปทันที ไม่ retry (รอไปก็ไม่หาย)
   * - โมเดลที่พักอยู่ = ข้ามโดยไม่ยิง · รุ่นสำรองล้มด้วยเหตุอื่น (เช่น 404 ไม่มีรุ่นนี้) = ข้ามเงียบ ๆ
   * - ตัวที่บอสเลือกล้มด้วยเหตุอื่น = กติกาเดิม (retry / fallback เจ้าถัดไป / โยน)
   * คืน null = ไปเจ้าถัดไป (ใส่สาเหตุไว้ใน `failures`)
   */
  private async tryProvider(
    { provider, models }: Plan,
    req: Omit<ChatRequest, 'model'>,
    retries: number,
    ignoreCooldown: boolean,
    failures: ProviderError[],
    call: (provider: AIProvider, req: ChatRequest) => Promise<ChatResponse>,
  ): Promise<ChatResponse | null> {
    const id = provider.config.id;
    const preferred = models[0] ?? provider.config.defaultModel;
    let ranOut = false; // ตัวที่บอสเลือกเพิ่งหมดรอบนี้ → ถ้ารุ่นสำรองตอบได้ ให้บอสรู้
    let tried = false;
    for (const [index, model] of models.entries()) {
      if (!ignoreCooldown && this.quota.isCooling(id, model)) continue;
      tried = true;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await call(provider, { ...req, model });
          this.quota.clear(id, model);
          if (ranOut && index > 0) {
            this.notices.add(
              `${provider.config.name}: โควต้าของ ${preferred} หมดชั่วคราว — สลับไปใช้ ${model} ให้เองแล้ว`,
            );
          }
          return res;
        } catch (e) {
          const err = toProviderError(id, e);
          if (isQuotaError(err)) {
            if (this.quota.strike(id, model) === 1 && index === 0) ranOut = true;
            if (index === 0) failures.push(err);
            break; // รุ่นถัดไป
          }
          if (index > 0) break; // รุ่นสำรองใช้ไม่ได้ — ไม่ใช่ความผิดของตัวที่บอสเลือก
          if (!err.shouldFallback) throw err;
          if (attempt < retries && RETRYABLE.has(err.kind)) {
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          if (this.lastGood === id) this.lastGood = null;
          failures.push(err);
          return null;
        }
      }
    }
    if (this.lastGood === id) this.lastGood = null;
    if (!tried) {
      failures.push(
        new ProviderError(id, 'rate_limit', 'โควต้าหมด — พักไว้ชั่วคราว จะลองใหม่เองเมื่อครบเวลา'),
      );
    }
    return null;
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
