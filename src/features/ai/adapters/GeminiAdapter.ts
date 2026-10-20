import { ProviderError } from '../../../core/http/errors';
import { requestJson, requestStream } from '../../../core/http/request';
import { streamingFetch } from '../../../core/http/streamingFetch';
import { isArray, isRecord, isString } from '../../../core/types/guards';
import { BaseAIProvider } from '../core/ProviderInterface';
import { geminiParts } from '../core/attachmentParts';
import { normalizeModelIds, parseGeminiModels } from '../core/modelLists';
import type { ChatRequest, ChatResponse } from '../core/types';

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

/** ข้อความของคำตอบหนึ่งก้อน — ข้าม part ที่เป็น "ความคิด" ของโมเดล (thought) ไม่ให้หลุดไปพูด */
function textOf(data: GenerateContentResponse): string {
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
}

/**
 * ตรวจรูปทรงของคำตอบ Gemini ที่เราอ่านจริง (ไม่ cast) — field ที่เหลืออ่านแบบ optional ทุกครั้ง
 * candidates/parts ต้องเป็น array ถ้ามี · text เป็น string ถ้ามี
 */
function isGenerateContentResponse(v: unknown): v is GenerateContentResponse {
  if (!isRecord(v)) return false;
  if (v.candidates === undefined) return true;
  if (!isArray(v.candidates)) return false;
  return v.candidates.every((c) => {
    if (!isRecord(c)) return false;
    if (c.content === undefined) return true;
    if (!isRecord(c.content)) return false;
    const parts = c.content.parts;
    return (
      parts === undefined ||
      (isArray(parts) &&
        parts.every((p) => isRecord(p) && (p.text === undefined || isString(p.text))))
    );
  });
}

/** pageSize สูงสุดที่ Gemini ยอม · ตามหน้าไม่เกิน MAX_PAGES กัน loop ไม่จบถ้า API ส่ง token วน */
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

/** Google Gemini via the Generative Language REST API (v1beta). */
export class GeminiAdapter extends BaseAIProvider {
  /** Key goes in a header rather than ?key= so it never lands in URLs or logs. */
  private async headers(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': await this.apiKey(), 'Content-Type': 'application/json' };
  }

  private body(req: ChatRequest): string {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: geminiParts(m),
      }));
    return JSON.stringify({
      contents,
      ...(system.length && { systemInstruction: { parts: [{ text: system.join('\n\n') }] } }),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
    });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const data = await requestJson<GenerateContentResponse>(
      this.config.id,
      this.url(`/v1beta/models/${encodeURIComponent(req.model)}:generateContent`),
      {
        method: 'POST',
        headers: await this.headers(),
        timeoutMs: req.timeoutMs,
        body: this.body(req),
      },
    );
    return this.toResponse(req, textOf(data), data, data);
  }

  /**
   * `streamGenerateContent?alt=sse` — ส่งข้อความทีละท่อนให้ `onDelta` ทันทีที่มาถึง (แอปเริ่มพูดก่อนตอบจบ)
   * body ที่ไม่ใช่ SSE (เช่น proxy/เทสต์ที่ตอบ JSON ก้อนเดียว) → อ่านทั้งก้อนแล้วส่งเป็นท่อนเดียว
   */
  async chatStream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResponse> {
    let pending = ''; // ข้อความที่ยังไม่ครบบรรทัด
    let raw = ''; // เก็บไว้เผื่อ body ไม่ใช่ SSE
    let sawEvent = false;
    let full = '';
    let last: GenerateContentResponse = {};
    let firstMeta: GenerateContentResponse = {};

    /** ก้อนข้อมูลหนึ่งก้อน (event SSE หรือ item ของ JSON array) → สะสมข้อความ + ส่งท่อนใหม่ */
    const handleData = (value: unknown) => {
      if (!isGenerateContentResponse(value)) return;
      sawEvent = true;
      if (!firstMeta.modelVersion && value.modelVersion) firstMeta = value;
      last = value;
      const text = textOf(value);
      if (text) {
        full += text;
        onDelta(text);
      }
    };

    await requestStream(
      this.config.id,
      this.url(`/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`),
      {
        method: 'POST',
        headers: await this.headers(),
        timeoutMs: req.timeoutMs,
        body: this.body(req),
        fetchImpl: streamingFetch,
      },
      (chunk) => {
        if (!sawEvent) raw += chunk;
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data:')) handleData(safeParse(line.slice(5).trim()));
        }
      },
    );
    if (pending.startsWith('data:')) handleData(safeParse(pending.slice(5).trim()));

    if (!sawEvent) {
      // ไม่ใช่ SSE → JSON ก้อนเดียว หรือ array ของก้อน (โหมด stream แบบไม่มี alt=sse)
      const parsed = safeParse(raw.trim());
      for (const item of isArray(parsed) ? parsed : [parsed]) handleData(item);
    }
    return this.toResponse(req, full, last, firstMeta);
  }

  /** ประกอบ ChatResponse · ข้อความว่าง = invalid_response (บอกเหตุผลที่ถูกบล็อกถ้ามี) */
  private toResponse(
    req: ChatRequest,
    text: string,
    last: GenerateContentResponse,
    meta: GenerateContentResponse,
  ): ChatResponse {
    const content = text.trim();
    if (!content) {
      const reason = last.promptFeedback?.blockReason ?? last.candidates?.[0]?.finishReason;
      throw new ProviderError(
        this.config.id,
        'invalid_response',
        reason ? `ไม่มีคำตอบ (${reason})` : 'ไม่มีข้อความในคำตอบ',
      );
    }
    const usage = last.usageMetadata;
    return {
      content,
      model: meta.modelVersion ?? last.modelVersion ?? req.model,
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

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
