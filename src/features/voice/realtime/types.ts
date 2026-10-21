/**
 * @file Realtime voice — type กลางของผู้ให้บริการเสียงสดแบบ speech-to-speech (OpenAI Realtime, ต่อไป Gemini Live ฯลฯ)
 *
 * ต่างจาก LiveVoiceSession (อัดไฟล์ → STT → LLM → TTS ทีละขั้น): โมเดลเสียงรับ/ตอบเป็นสตรีมเดียว
 * session ไม่รู้จัก WebRTC / WebSocket — คุยกับ `RealtimeTransport` เท่านั้น เพื่อให้เปลี่ยนเจ้าได้และ test ได้
 */

export type RealtimeProviderId = 'openai' | 'gemini';

export interface RealtimeToolDef {
  name: string;
  description: string;
  /** JSON Schema ของ argument */
  parameters: Record<string, unknown>;
}

export interface RealtimeConfig {
  /** คำสั่งระบบของโมเดลเสียง — สั้นเข้าไว้ (ทุกโทเคนของ prompt ถูกคิดเงินทุกเทิร์น) */
  instructions: string;
  voice: string;
  tools: readonly RealtimeToolDef[];
}

export interface RealtimeToolCall {
  callId: string;
  name: string;
  /** JSON string ตามที่โมเดลส่งมา */
  args: string;
}

/** สิ่งที่ transport แจ้งกลับมายัง session */
export interface RealtimeEvents {
  /** ผู้ใช้เริ่มพูด (ใช้ตัดคำตอบที่กำลังพูดอยู่ = barge-in) */
  onSpeechStarted(): void;
  /** ถอดเสียงผู้ใช้จบแล้ว */
  onUserTranscript(text: string): void;
  /** โมเดลเริ่มตอบ */
  onResponseStarted(): void;
  /** คำตอบของโมเดล (ข้อความที่ถูกพูด) จบแล้ว */
  onAssistantTranscript(text: string): void;
  /** คำตอบจบ — hadToolCall = จบเพราะขอเรียก tool (ยังไม่ใช่คำตอบสุดท้าย) */
  onResponseDone(info: { hadToolCall: boolean }): void;
  onToolCall(call: RealtimeToolCall): void;
  onError(error: Error): void;
  /** การเชื่อมต่อถูกปิด (ฝั่งเซิร์ฟเวอร์ / เน็ตหลุด) */
  onClosed(): void;
}

export interface RealtimeTransport {
  /** เปิดการเชื่อมต่อ + เปิดไมค์ · resolve เมื่อพร้อมรับเสียง */
  connect(config: RealtimeConfig, events: RealtimeEvents): Promise<void>;
  /** ส่งผล tool กลับแล้วให้โมเดลตอบต่อ */
  sendToolResult(callId: string, output: string): void;
  /** หยุดเสียงที่กำลังพูด + ยกเลิกคำตอบที่ค้าง */
  interrupt(): void;
  /** ปิดทุกอย่าง (ไม่ throw) */
  close(): void;
}

export interface RealtimeProvider {
  id: RealtimeProviderId;
  name: string;
  createTransport(): RealtimeTransport;
  /** มี key / ใช้งานได้ไหม — false = ให้ตกไปใช้โหมดอัดไฟล์เดิม */
  isConfigured(): Promise<boolean>;
}
