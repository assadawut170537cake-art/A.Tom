import { ProviderError } from '../../../core/http/errors';
import { requestJson } from '../../../core/http/request';
import { BaseAIProvider } from '../core/ProviderInterface';
import type { ChatRequest, ChatResponse } from '../core/types';

/**
 * Jev (TypeSafe) "System One" API — answers yes/no, choice and score questions about some content.
 * It classifies rather than generates text, so A.T.O.M. uses it as a router (purpose: 'router'),
 * not as a chat LLM. Schema: https://api.typesafe.ai/openapi.json (v0.2.0).
 */

type Instructions = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: 'noul'; instructions?: Instructions; criteria?: { true?: Instructions; false?: Instructions } }
  | { type: 'choice'; instructions?: Instructions; criteria: Record<string, Instructions | null> }
  | { type: 'score'; instructions?: Instructions; criteria: Instructions[] };

export type JevAnswer =
  /** noul: probability of "yes"/true, 0..1 */
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; confidence?: number; legend?: Record<string, unknown> };

/** Content the questions refer to. */
export type JevState = string | Record<string, unknown> | unknown[];

export interface SystemOneResult<K extends string = string> {
  model: string;
  answers: Record<K, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JevAdapter extends BaseAIProvider {
  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.apiKey()}`, 'Content-Type': 'application/json' };
  }

  /** Ask named questions about `state`; answers come back under the same names. */
  async ask<K extends string>(
    state: JevState,
    questions: Record<K, JevQuestion>,
    model = this.config.defaultModel
  ): Promise<SystemOneResult<K>> {
    const data = await requestJson<SystemOneResult<K>>(this.config.id, this.url('/v1/systemone'), {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ model, state, questions }),
    });
    if (!data.answers || !Object.keys(data.answers).length) {
      throw new ProviderError(this.config.id, 'invalid_response', 'ไม่มีคำตอบ');
    }
    return data;
  }

  /** System One cannot generate free text; use ask() for routing decisions. */
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    throw new ProviderError(
      this.config.id,
      'unsupported',
      'Jev เป็นตัวจัดเส้นทาง (router) ไม่รองรับการสร้างข้อความ — ใช้ ask() แทน'
    );
  }

  override async getModels(): Promise<string[]> {
    const data = await this.listModels();
    return data.models.map((m) => m.name);
  }

  protected probe(): Promise<unknown> {
    return this.listModels();
  }

  private async listModels(): Promise<{ models: { name: string }[] }> {
    return requestJson(this.config.id, this.url('/v1/models'), { headers: await this.headers() });
  }
}
