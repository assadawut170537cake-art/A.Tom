import { ProviderError } from '../../../core/http/errors';
import { requestJson } from '../../../core/http/request';
import { BaseAIProvider } from '../core/ProviderInterface';
import type { ChatRequest, ChatResponse } from '../core/types';

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
}

interface ModelListResponse {
  models?: { name: string; supportedGenerationMethods?: string[] }[];
  nextPageToken?: string;
}

/** Google Gemini via the Generative Language REST API (v1beta). */
export class GeminiAdapter extends BaseAIProvider {
  /** Key goes in a header rather than ?key= so it never lands in URLs or logs. */
  private async headers(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': await this.apiKey(), 'Content-Type': 'application/json' };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const data = await requestJson<GenerateContentResponse>(
      this.config.id,
      this.url(`/v1beta/models/${encodeURIComponent(req.model)}:generateContent`),
      {
        method: 'POST',
        headers: await this.headers(),
        timeoutMs: req.timeoutMs,
        body: JSON.stringify({
          contents,
          ...(system.length && { systemInstruction: { parts: [{ text: system.join('\n\n') }] } }),
          generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
        }),
      }
    );

    const parts = data.candidates?.[0]?.content?.parts;
    const text = parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) {
      const reason = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason;
      throw new ProviderError(
        this.config.id,
        'invalid_response',
        reason ? `ไม่มีคำตอบ (${reason})` : 'ไม่มีข้อความในคำตอบ'
      );
    }
    return {
      content: text,
      model: data.modelVersion ?? req.model,
      providerId: this.config.id,
      tokensUsed: data.usageMetadata
        ? {
            input: data.usageMetadata.promptTokenCount ?? 0,
            output: data.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }

  /** Live list of models that support generateContent. */
  async getModels(): Promise<string[]> {
    const data = await this.listModels();
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
  }

  protected probe(): Promise<unknown> {
    return this.listModels(1);
  }

  private async listModels(pageSize = 1000): Promise<ModelListResponse> {
    return requestJson<ModelListResponse>(
      this.config.id,
      this.url(`/v1beta/models?pageSize=${pageSize}`),
      { headers: await this.headers() }
    );
  }
}
