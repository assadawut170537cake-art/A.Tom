/**
 * @file ต่อ ChatSync (core) เข้ากับ useAtomStore + การจับคู่ Mark 55 — "ห้องแชทเดียวกัน" ระดับแอป (ADR-015)
 *
 * core/chat ไม่รู้จัก store → ที่นี่เชื่อมสองทาง:
 * - ข้อความใหม่ในเครื่อง (user/assistant) → `setLocalMessageSink` → `chatSync.enqueue`
 * - ข้อความจากเครื่องอื่น → `chatSync.apply` → `store.mergeRemoteMessages` (ไม่วิ่งผ่าน pushMessage จึงไม่ส่งกลับ)
 *
 * การจับคู่มาจาก `memorySync` (Mark 55 ตัวเดียวกับ Shared Memory) — ฟัง subscribe:
 * จับคู่ → ตั้ง remote + ส่งแชทที่มีอยู่ขึ้นรอบแรก · ยกเลิกจับคู่ → ล้าง (แชทในเครื่องไม่หาย)
 */

import { ChatSync } from '../../core/chat/ChatSync';
import { isSyncableRole, type SyncMessage } from '../../core/chat/chatSyncTypes';
import {
  RemoteChatAdapter,
  type ChatRemote,
  type RemoteChatConfig,
} from '../../core/chat/RemoteChatAdapter';
import { memorySync } from '../../core/memory/MemorySync';
import type { Message } from '../../core/types/message';
import { setLocalMessageSink, useAtomStore } from '../jarvis/stores/useAtomStore';

/** Message (user/assistant) → SyncMessage · role อื่นคืน null (ไม่ซิงก์) */
export function toSyncMessage(message: Message): SyncMessage | null {
  if (!isSyncableRole(message.role)) return null;
  return {
    id: message.id,
    persona: message.persona,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export interface ChatSyncBridgeDeps {
  chatSync?: ChatSync | undefined;
  createRemote?: ((config: RemoteChatConfig) => ChatRemote) | undefined;
  /** ไม่ส่ง = ใช้ memorySync ของแอป */
  connection?: (() => Promise<{ baseUrl: string; token: string } | null>) | undefined;
  subscribe?: ((listener: () => void) => () => void) | undefined;
}

/**
 * เริ่มระบบห้องแชทเดียวกัน — คืนฟังก์ชันหยุด (ใช้ใน test) · boot เรียกครั้งเดียว
 * fail-open: ล้มที่ไหนก็ log แล้วทำงานต่อแบบเครื่องเดียว
 */
export function startChatSync(deps: ChatSyncBridgeDeps = {}): () => void {
  const store = useAtomStore;
  const chatSync =
    deps.chatSync ??
    new ChatSync({ apply: (messages) => store.getState().mergeRemoteMessages(messages) });
  const createRemote: (config: RemoteChatConfig) => ChatRemote =
    deps.createRemote ?? ((config) => new RemoteChatAdapter(config));
  const connection = deps.connection ?? (() => memorySync.connection());
  const subscribe = deps.subscribe ?? memorySync.subscribe;

  // ข้อความใหม่ในเครื่อง → คิวส่ง
  setLocalMessageSink((message) => {
    const sync = toSyncMessage(message);
    if (sync) void chatSync.enqueue([sync]);
  });

  let pairedNow = false;
  const applyConnection = async (): Promise<void> => {
    try {
      const conn = await connection();
      if (conn && !pairedNow) {
        pairedNow = true;
        chatSync.setRemote(createRemote(conn));
        await chatSync.enqueue(collectSyncable()); // ส่งแชทที่มีอยู่ขึ้นรอบแรก
      } else if (!conn && pairedNow) {
        pairedNow = false;
        await chatSync.reset();
      }
    } catch (e) {
      console.error('[chat-sync] ตั้งค่าการเชื่อมต่อห้องแชทไม่สำเร็จ', e);
    }
  };

  const unsubscribe = subscribe(() => void applyConnection());
  void chatSync.restore().then(applyConnection);

  return () => {
    unsubscribe();
    setLocalMessageSink(null);
    chatSync.stop();
  };
}

/** ข้อความ user/assistant ทั้งหมดในเครื่องตอนนี้ (ตอนจับคู่ครั้งแรก) */
function collectSyncable(): SyncMessage[] {
  const { messagesByPersona } = useAtomStore.getState();
  return Object.values(messagesByPersona)
    .flat()
    .flatMap((m) => toSyncMessage(m) ?? []);
}
