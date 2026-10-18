import { ProviderError } from '../../../core/http/errors';
import { requestJson, requestSSE } from '../../../core/http/request';
import { isRecord, parseJSON } from '../../../core/types/guards';
import { BaseAIProvider } from '../core/ProviderInterface';
import { parseOpenAIModels } from '../core/modelLists';
import type { ChatRequest, ChatResponse, PartialTextListener } from '../core/types';

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Base for any OpenAI-compatible /chat/completions API (OpenRouter, custom gateways, …). */
export class OpenAICompatibleAdapter extends BaseAIProvider {
  /** Extra headers on every request (e.g. OpenRouter attribution). */
  protected extraHeaders(): Record<string, string> {
    return {};
  }

  /** field เพิ่มใน body ของ /chat/completions (เช่น web plugin ของ OpenRouter) */
  protected extraBody(_req: ChatRequest): Record<string, unknown> {
    return {};
  }

  private body(req: ChatRequest, stream: boolean): string {
    return JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      ...(stream && { stream: true }),
      ...this.extraBody(req),
    });
  }

  protected async headers(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.apiKey()}`,
      'Content-Type': 'application/json',
      ...this.extraHeaders(),
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const data = await requestJson<ChatCompletionResponse>(
      this.config.id,
      this.url('/chat/completions'),
      {
        method: 'POST',
        headers: await this.headers(),
        timeoutMs: req.timeoutMs,
        body: this.body(req, false),
      }
    );

    const content = data.choices?.[0]?.message?.content;
    if (content == null) {
      throw new ProviderError(this.config.id, 'invalid_response', 'ไม่มีข้อความในคำตอบ');
    }
    return {
      content,
      model: data.model ?? req.model,
      providerId: this.config.id,
      tokensUsed: data.usage
        ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }

  /** `stream: true` → SSE ที่แต่ละ event มี choices[0].delta.content */
  async chatStream(req: ChatRequest, onText: PartialTextListener): Promise<ChatResponse> {
    let text = '';
    let model: string | undefined;
    let usage: ChatCompletionResponse['usage'];
    await requestSSE(
      this.config.id,
      this.url('/chat/completions'),
      { method: 'POST', headers: await this.headers(), timeoutMs: req.timeoutMs, body: this.body(req, true) },
      (data) => {
        // Cast: รูปแบบตามมาตรฐาน OpenAI — ทุก field อ่านแบบ optional
        const event = parseJSON(data, isRecord) as ChatCompletionResponse | null;
        if (!event) return;
        model ??= event.model;
        usage = event.usage ?? usage;
        // server ที่ไม่ยอม stream ตอบเป็น message ทั้งก้อน — รับได้เหมือนกัน
        const choice = event.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
        if (delta) {
          text += delta;
          onText(text);
        }
      }
    );
    if (!text) throw new ProviderError(this.config.id, 'invalid_response', 'ไม่มีข้อความในคำตอบ');
    return {
      content: text,
      model: model ?? req.model,
      providerId: this.config.id,
      tokensUsed: usage ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } : undefined,
    };
  }

  override async getModels(): Promise<string[]> {
    if (this.config.models !== 'dynamic') return super.getModels();
    return this.listModels();
  }

  /** `GET {baseURL}/models` → `data[].id` (มาตรฐาน OpenAI — OpenRouter/gateway ส่วนใหญ่ใช้รูปแบบนี้) */
  async listModels(): Promise<string[]> {
    const data = await requestJson<unknown>(this.config.id, this.url('/models'), {
      headers: await this.headers(),
    });
    return parseOpenAIModels(this.config.id, data);
  }

  protected probe(): Promise<unknown> {
    return this.headers().then((headers) =>
      requestJson(this.config.id, this.url('/models'), { headers })
    );
  }
}
