import { ProviderError } from '../../../core/http/errors';
import { requestJson } from '../../../core/http/request';
import { BaseAIProvider } from '../core/ProviderInterface';
import type { ChatRequest, ChatResponse } from '../core/types';

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ModelListResponse {
  data?: { id: string }[];
}

/** Base for any OpenAI-compatible /chat/completions API (OpenRouter, custom gateways, …). */
export class OpenAICompatibleAdapter extends BaseAIProvider {
  /** Extra headers on every request (e.g. OpenRouter attribution). */
  protected extraHeaders(): Record<string, string> {
    return {};
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
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
        }),
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

  async getModels(): Promise<string[]> {
    if (this.config.models !== 'dynamic') return super.getModels();
    const data = await requestJson<ModelListResponse>(this.config.id, this.url('/models'), {
      headers: await this.headers(),
    });
    return (data.data ?? []).map((m) => m.id).sort();
  }

  protected probe(): Promise<unknown> {
    return this.headers().then((headers) =>
      requestJson(this.config.id, this.url('/models'), { headers })
    );
  }
}
