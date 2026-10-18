/**
 * @file IntentRouter ตัวที่แอปใช้จริง — composition root ของ feature router (singleton)
 *
 * ประกอบ ChatHandler ด้วย Shared Memory (`localMemory`) → facts ถูกแนบท้าย system prompt ทุกครั้งที่คุย
 * ChatHandler ไม่ได้ถูกแก้: แค่ส่ง memory ผ่าน constructor (ตัวที่สามซึ่งรองรับไว้ตั้งแต่ Phase 4 scaffold)
 * test ยังสร้าง `new IntentRouter()` เปล่า ๆ (ไม่มี memory) ได้เหมือนเดิม
 * + agent ใช้ tool (MCP / ทักษะ / ควบคุมเครื่อง) — ทำงานเฉพาะเมื่อบอสเปิด tool ไว้
 */

import { localMemory } from '../../core/memory/LocalMemoryAdapter';
import type { MemoryStore } from '../../core/memory/types';
import { createChatToolAgent } from '../ai/agent';
import { aiOrchestrator } from '../ai/core/Orchestrator';
import { getPersonaPrompt } from '../ai/prompts/personaPrompts';
import { IntentRouter } from './core/IntentRouter';
import { ChatHandler } from './handlers/ChatHandler';

export function createAppRouter(memory: MemoryStore = localMemory): IntentRouter {
  return new IntentRouter({
    handlers: { chat: new ChatHandler(aiOrchestrator, getPersonaPrompt, memory, createChatToolAgent()) },
  });
}

let appRouter: IntentRouter | null = null;

/** สร้างครั้งแรกที่ใช้ แล้วใช้ตัวเดิมตลอดอายุแอป */
export function getAppRouter(): IntentRouter {
  return (appRouter ??= createAppRouter());
}
