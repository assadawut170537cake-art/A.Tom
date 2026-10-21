import type { ChatMessage } from '../../ai/core/types';
import type { Persona } from '../../../core/types/persona';
import type { AttachmentData } from '../../../core/types/attachment';

export const INTENTS = ['chat', 'pc_command', 'switch_assistant', 'agent'] as const;
export type Intent = (typeof INTENTS)[number];

/**
 * Intents that Jev / the LLM classifier may answer. `agent` is left out on purpose: a model label
 * alone can't say *which* agent, so only AgentClassifier (pattern match on registered capabilities)
 * produces agent routes.
 */
export const MODEL_INTENTS = [
  'chat',
  'pc_command',
  'switch_assistant',
] as const satisfies readonly Intent[];
export type ModelIntent = (typeof MODEL_INTENTS)[number];

/** Which stage decided the route. */
export type RouteSource = 'rule' | 'agent' | 'jev' | 'llm';

/** Persona id as carried in route entities ('1' | '2' | '3' | '4'). */
export type PersonaEntity = `${Persona}`;

export interface RouterInput {
  text: string;
  /**
   * มี = ขอให้ส่งคำตอบทีละท่อนระหว่างที่ AI ยังพิมพ์ (ChatHandler สตรีม · handler อื่นไม่เรียก)
   * ใช้ให้แอปเริ่มพูด/แสดงข้อความก่อนตอบจบ — ไม่เปลี่ยนการ route (เสียงกับพิมพ์ route ทางเดียวกัน)
   */
  onDelta?: ((text: string) => void) | undefined;
  /** ไฟล์ที่บอสแนบ (อ่านเนื้อแล้ว) — มี = ส่งเข้าแชทเสมอ เพราะมีแค่ ChatHandler ที่ส่งไฟล์ให้ AI อ่านได้ */
  attachments?: AttachmentData[] | undefined;
  context?: {
    activePersona?: Persona;
    recentMessages?: string[];
    /** Full role-tagged history for the active persona, used by ChatHandler. */
    history?: ChatMessage[];
  };
}

interface RouteBase {
  confidence: number;
  provider: RouteSource;
}

/**
 * Discriminated on `intent`: each intent carries its own (optional) entities, so narrowing on
 * `route.intent` gives handlers typed fields instead of a free-form string map.
 */
export type RouterOutput =
  | (RouteBase & { intent: 'chat'; entities?: undefined })
  | (RouteBase & { intent: 'pc_command'; entities?: { action: string; target: string } })
  | (RouteBase & { intent: 'switch_assistant'; entities?: { persona: PersonaEntity } })
  | (RouteBase & { intent: 'agent'; entities: AgentEntities });

/** agent ที่ต้องรัน + เนื้อคำสั่ง (เช่น "จดบันทึกว่า ซื้อนม" → commandText "ซื้อนม") */
export interface AgentEntities {
  agentId: string;
  commandText: string;
  capabilityId?: string | undefined;
}

export type RouteOf<I extends Intent> = Extract<RouterOutput, { intent: I }>;

export interface Classifier {
  /** null = no opinion (let the next classifier decide). */
  classify(input: RouterInput): Promise<RouterOutput | null>;
}

export interface HandlerResult {
  /** Text to show (and speak) as the assistant's reply. */
  reply: string;
  /** Persona that should own the reply (differs from the input persona after a switch). */
  persona: Persona;
  /** agent ที่ขอเปิด UI (Agent Panel บนหน้าหลัก) — มีเฉพาะผลจาก AgentHandler */
  agentScreen?: { agentId: string } | undefined;
  /** true = ข้อความถูกส่งผ่าน `onDelta` ครบแล้ว (ผู้เรียกพูด/แสดงไประหว่างทางแล้ว ไม่ต้องพูดซ้ำทั้งก้อน) */
  streamed?: boolean | undefined;
  /** รูปที่แนบกับคำตอบ — มีเฉพาะผลจาก AgentHandler */
  imageUri?: string | undefined;
}

export interface IntentHandler<I extends Intent = Intent> {
  handle(input: RouterInput, route: RouteOf<I>): Promise<HandlerResult>;
}

/** One handler per intent, each receiving only its own route variant. */
export type IntentHandlers = { [I in Intent]: IntentHandler<I> };
