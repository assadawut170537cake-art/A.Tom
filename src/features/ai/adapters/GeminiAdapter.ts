import { ProviderError, toProviderError } from '../../../core/http/errors';
import { requestJson, requestSSE } from '../../../core/http/request';
import { isRecord, parseJSON } from '../../../core/types/guards';
import { BaseAIProvider } from '../core/ProviderInterface';
import { normalizeModelIds, parseGeminiModels } from '../core/modelLists';
import type { ChatRequest, ChatResponse, PartialTextListener } from '../core/types';

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

/** pageSize สูงสุดที่ Gemini ยอม · ตามหน้าไม่เกิน MAX_PAGES กัน loop ไม่จบถ้า API ส่ง token วน */
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
/** แหล่งข้อมูลจากการค้นเว็บที่แนบท้ายคำตอบ */
const MAX_SOURCES = 3;

/** "แหล่งข้อมูล: [ชื่อ](url) · …" จาก grounding ของ Google Search ('' = ไม่ได้ค้น) */
export function formatSources(chunks: GroundingChunk[]): string {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (!uri || !/^https?:\/\//.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    const title = (c.web?.title ?? new URL(uri).hostname).replace(/[[\]()]/g, '');
    links.push(`[${title}](${uri})`);
    if (links.length >= MAX_SOURCES) break;
  }
  return links.length ? `\n\nแหล่งข้อมูล: ${links.join(' · ')}` : '';
}

/** Google Gemini via the Generative Language REST API (v1beta). */
export class GeminiAdapter extends BaseAIProvider {
  /** Key goes in a header rather than ?key= so it never lands in URLs or logs. */
  private async headers(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': await this.apiKey(), 'Content-Type': 'application/json' };
  }

  private body(req: ChatRequest, withTools: boolean): string {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    return JSON.stringify({
      contents,
      ...(system.length && { systemInstruction: { parts: [{ text: system.join('\n\n') }] } }),
      ...(withTools && { tools: [{ google_search: {} }] }),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
    });
  }

  /**
   * ค้นเว็บอยู่แล้วโดน 400 (โมเดลบางตัวไม่รองรับ google_search) → ลองใหม่แบบไม่ค้น
   * เพราะ Orchestrator ไม่ fallback ให้เมื่อเจอ 400
   */
  private async withSearchFallback<T>(req: ChatRequest, run: (withTools: boolean) => Promise<T>): Promise<T> {
    if (!req.webSearch) return run(false);
    try {
      return await run(true);
    } catch (e) {
      const err = toProviderError(this.config.id, e);
      if (err.kind !== 'bad_request') throw err;
      return run(false);
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.withSearchFallback(req, async (withTools) => {
      const data = await requestJson<GenerateContentResponse>(
        this.config.id,
        this.url(`/v1beta/models/${encodeURIComponent(req.model)}:generateContent`),
        { method: 'POST', headers: await this.headers(), timeoutMs: req.timeoutMs, body: this.body(req, withTools) }
      );
      return this.toResponse(req, [data]);
    });
  }

  /** `:streamGenerateContent?alt=sse` — ทุก event มี candidates[].content.parts ส่วนที่เพิ่ม */
  async chatStream(req: ChatRequest, onText: PartialTextListener): Promise<ChatResponse> {
    return this.withSearchFallback(req, async (withTools) => {
      const events: GenerateContentResponse[] = [];
      let text = '';
      await requestSSE(
        this.config.id,
        this.url(`/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`),
        { method: 'POST', headers: await this.headers(), timeoutMs: req.timeoutMs, body: this.body(req, withTools) },
        (data) => {
          // บาง proxy ส่ง array ของ event มาทั้งก้อน
          const parsed = parseJSON(data, (v): v is unknown => Array.isArray(v) || isRecord(v));
          // Cast: รูปแบบตาม schema ของ Gemini — ทุก field อ่านแบบ optional อยู่แล้ว
          const list = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord) as GenerateContentResponse[];
          for (const event of list) {
            events.push(event);
            const delta = event.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
            if (delta) {
              text += delta;
              onText(text);
            }
          }
        }
      );
      return this.toResponse(req, events);
    });
  }

  private toResponse(req: ChatRequest, events: GenerateContentResponse[]): ChatResponse {
    const text = events
      .flatMap((e) => e.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    const last = events.at(-1);
    if (!text) {
      const reason =
        events.map((e) => e.promptFeedback?.blockReason).find(Boolean) ?? last?.candidates?.[0]?.finishReason;
      throw new ProviderError(
        this.config.id,
        'invalid_response',
        reason ? `ไม่มีคำตอบ (${reason})` : 'ไม่มีข้อความในคำตอบ'
      );
    }
    const chunks = events.flatMap((e) => e.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []);
    const usage = events.map((e) => e.usageMetadata).filter(Boolean).at(-1);
    return {
      content: text + formatSources(chunks),
      model: last?.modelVersion ?? req.model,
      providerId: this.config.id,
      tokensUsed: usage
        ? { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 }
        : undefined,
    };
  }

  /** Live list of models that support generateContent. */
  override getModels(): Promise<string[]> {
    return this.listModels();
  }

  /** `GET /v1beta/models` (ทุกหน้า) → เฉพาะโมเดลที่ใช้ generateContent ได้ */
  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `pageSize=${PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const parsed = parseGeminiModels(this.config.id, await this.fetchModelPage(query));
      ids.push(...parsed.ids);
      pageToken = parsed.nextPageToken;
      if (!pageToken) break;
    }
    return normalizeModelIds(ids);
  }

  protected probe(): Promise<unknown> {
    return this.fetchModelPage('pageSize=1');
  }

  private async fetchModelPage(query: string): Promise<unknown> {
    return requestJson<unknown>(this.config.id, this.url(`/v1beta/models?${query}`), {
      headers: await this.headers(),
    });
  }
}
