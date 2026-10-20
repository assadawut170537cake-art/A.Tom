# CORE AUDIT — แกนหลัก vs โมดูล (2026-10-20)

> Boss อนุมัติ 2026-10-20: "ต้องการแกนหลักของระบบก่อน · แกนหลักต้องเชื่อม API ได้ทุกรูปแบบและเพิ่มได้ในอนาคต · อะไรที่ควรเป็นเครื่องมือ / MCP / โมดูล / ปลั๊กอิน ให้ย้ายไปอยู่ตามที่ควร"
> ไฟล์นี้ = แผน · ย้ายจริงทีละขั้น (มี test คุมทุกขั้น) · โค้ดที่บอสเขียนเอง (เช่น `modules/agents/route-escort`) ไม่แตะ

## หลักแบ่ง

| อยู่ใน | เงื่อนไข |
|---|---|
| **แกนหลัก (core)** | ไม่มีแล้วแอปคุย/ฟัง/พูด/จำ/สลับ persona ไม่ได้ · เป็น "ช่องเสียบ" ให้ของอื่นมาเสียบ |
| **ชุดผู้ให้บริการ (provider pack)** | เจ้า AI / TTS / STT แต่ละเจ้า — ลงทะเบียนเข้า registry · เปิด/ปิด/เพิ่มเองได้จากแอป |
| **โมดูล (module)** | ความสามารถเสริมที่มีสถานะ/รันเบื้องหลัง · ลงผ่าน `ModuleRegistry` · ปิดแล้วแกนยังทำงาน |
| **ปลั๊กอิน / agent** | คำสั่งจากแชท (regex + UI) ผ่าน `AgentRegistry` |
| **MCP / เครื่องมือ** | ความสามารถที่อยู่นอกมือถือ (PC, เว็บ) — เรียกผ่าน `MCPClientBridge` |

## แกนหลัก — เก็บไว้ (≈ 9,000 บรรทัด)

| ส่วน | ไฟล์ | หมายเหตุ |
|---|---|---|
| HTTP / error / redaction | `core/http`, `core/network` | |
| types / storage / crypto | `core/types`, `core/storage`, `core/crypto` | `sigv4` ใช้แค่ Polly → ย้ายไปกับ pack ทีหลัง (ไม่เร่ง) |
| ระบบเสียบปลั๊ก | `core/modules`, `core/agents`, `core/agent/AgentHarness`, `MCPClientBridge`, `SkillEngine` | นี่คือ "ช่องเสียบ" — ต้องแข็งแรงที่สุด |
| ความจำในเครื่อง | `core/memory/{types,LocalMemoryAdapter,promptLine}` | |
| สมอง | `features/ai/core/*` (Orchestrator · ProviderRegistry · QuotaGuard · types) · `OpenAICompatibleAdapter` · `prompts/` | adapter กลาง = ใช้กับเจ้าใหม่ได้ทันที |
| เสียง | `features/voice/core/*` · `live/*` · Expo TTS/STT (ตัวสุดท้ายที่ฟรี) | |
| ตัดสินใจ | `features/router/*` (Rule → Agent → Jev → LLM) | |
| หน้าจอหลัก | `features/jarvis`, `features/memory`, `features/agents`, `features/settings` (เฉพาะโครง), `features/marketplace` | |

## ย้ายออก

| ตอนนี้อยู่ | ย้ายเป็น | เหตุผล |
|---|---|---|
| Gemini · OpenRouter · Dahl ×3 · xAI · Jev adapters + `providers.config` | **provider pack** (รายการในคลัง ไม่ใช่โค้ดล็อก) · Gemini = pack ติดเครื่องค่าเริ่มต้น | เพิ่ม/ลบเจ้าไม่ต้องแก้แกน |
| TTS/STT 17 เจ้า (`features/voice/tts`, `stt` ยกเว้น Expo) | **provider pack** | เหมือนกัน |
| *(ใหม่)* | **"เพิ่มผู้ให้บริการเอง"** — URL + key + model สำหรับ AI / TTS / STT (OpenAI-compatible) | คอนเซ็ปต์ "ต่อได้ทุก API" โดยไม่ต้องรอโค้ด |
| `core/memory/{RemoteMemoryAdapter,SyncQueue,MemorySync}` · `core/chat/*` · `features/chat/chatSyncBridge` | **module `mark55-sync`** | ผูกกับ server ภายนอก — แกนไม่ควรรู้จัก Mark 55 |
| `features/pc-bridge/*` · `modules/pc-inbox.ts` | **module `mark55-bus`** | |
| `core/memory/{SuperMemorySync,SecretSync}` | **module `supermemory`** | บริการภายนอก |
| `core/agent/DeviceControlBridge` · `modules/agents/{device-agent,confirmations,thaiNumber}` | **module `device-control`** (native `modules/atom-device` อยู่ใน APK เหมือนเดิม) | |
| `modules/agents/ultron-agent` (+ `mark55/ultron_sandbox.py`) | **module `ultron`** · ระยะยาว: ฝั่ง PC เป็น **MCP server** | |
| `modules/agents/standby-agent` | **module `standby`** (เสียบกับ live voice) | |
| `modules/agents/sample-agent` (โน้ต) | **ปลั๊กอินตัวอย่าง** | |
| `modules/agents/task-agent` | คงไว้ใกล้แกน (ทางเข้า AgentHarness จากแชท) | |
| สั่ง PC / Hermes / sandbox | ระยะยาว **MCP บน Mark 55** แทนตาราง Supabase เฉพาะทาง | MCP = มาตรฐานเดียว เสียบอะไรก็ได้ |

## ล็อกใหม่ (แทน "ล็อกชื่อเจ้า")

ล็อก **สัญญาของแกน** ไม่ล็อกรายชื่อเจ้า:
1. ผู้ให้บริการทุกประเภทเข้าทาง registry + interface กลาง (`AIProvider` / `TTSProvider` / `STTProvider`) เท่านั้น
2. ต้องเพิ่มเจ้าใหม่ได้จากในแอป (OpenAI-compatible) โดยไม่แก้โค้ด
3. ความสามารถเสริม = module / agent / MCP — ปิดแล้วแกนยังคุย/ฟัง/พูด/จำได้
4. ลำดับสลับอัตโนมัติ: Priority → fallback → lastGood → สลับรุ่นเมื่อโควต้าหมด (เดิม)
5. Storage: SecureStore (secret) + AsyncStorage (data) · Chat history แยกต่อ persona (เดิม)

## ลำดับงาน

1. ✅ รายงานนี้
2. ล็อกใหม่ใน `CLAUDE.md` + **เพิ่มผู้ให้บริการเองจากในแอป** (AI / TTS / STT)
3. **Marketplace แบบ "ของคุณ / สำรวจ" + หมวดหมู่** (คลังรวม: ผู้ให้บริการ · MCP · ทักษะ · โมดูล · ปลั๊กอิน)
4. อัลตรอนเขียนโค้ดแบบวน (เขียน → รัน sandbox → แก้เอง ≤ 3 รอบ → รายงาน)
5. โหมดคุยเรียลไทม์ Gemini Live (native สตรีมเสียง)
6. ย้ายของออกจากแกนตามตาราง (ทีละโมดูล)
7. ระบบแก้ตัวเองผ่าน OTA (`expo-updates` — อัลตรอนเขียน · บอสอนุมัติ)
