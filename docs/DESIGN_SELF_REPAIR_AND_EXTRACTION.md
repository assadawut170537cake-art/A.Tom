# DESIGN — task 4 (ซ่อมตัวเอง เข้า flow จริง) + task 5 (ย้ายของออกจากแกน)

> ร่างโดย Claude (coder) · **รอ DeepSeek (architect) / Boss เคาะก่อนลงมือ** · อิง `docs/CONCEPT.md` + `docs/CORE_AUDIT.md`
> engine พร้อมแล้ว: `core/selfRepair/{SnapshotStore,SelfRepair,types}` (snapshot ≤5 · rollback · learning log · จัดลำดับวิธีตามผลล่าสุด)
> ขอบเขตที่ทำเองได้ (ไม่ต้องอนุมัติเพิ่ม) = **การตั้งค่า/ข้อมูลใน AsyncStorage** · แก้โค้ด/OTA = ด่านอนุมัติ (ไม่อยู่ในร่างนี้)

---

## TASK 4 — เสียบ SelfRepair เข้า flow จริง

### ปัญหาที่แก้
ตอนนี้ค่าใน AsyncStorage ที่ "เสีย" (raw มีอยู่แต่ guard ไม่ผ่าน) → `readJSON` คืน `null` + `console.error` แล้วแอปใช้ค่าเริ่มต้นต่อ **แต่ raw เสียยังค้างในเครื่อง** → อ่านรอบหน้าก็เสียซ้ำ/อาจลาม ไม่มีการกู้คืนเป็นระบบ และไม่มีบันทึกว่าซ่อมด้วยวิธีไหน

### แนวทาง (เสนอ)
1. **ทะเบียนจุดที่กู้ได้ (`SettingsHealth`)** — core: ลิสต์ `{ key, label, isHealthy(), reset() }` ต่อ blob สำคัญ
   - `isHealthy()` = อ่าน raw; `raw == null` (ไม่มี = ปกติ) หรือ guard ผ่าน → healthy · raw มีแต่ guard ไม่ผ่าน → เสีย
   - `reset()` = วิธีซ่อม 1 วิธี (ลบ key / เขียนค่า default) — ภายหลังเพิ่มวิธีอื่น (เช่น migrate) ได้ตามรูปแบบ `RepairMethod`
2. **boot integrity pass** — ใน `bootApp()` (หลัง moduleManager.start) เรียก `settingsHealth.check()`:
   - blob ไหนเสีย → `selfRepair.repair(key, [key], [resetMethod])` (snapshot ก่อน → reset → log) · ล้มก็ fail-open ไม่ทำให้ boot reject (เหมือน memory/module เดิม)
3. **เรียกเองได้** — dev tool `selfRepairDevTools` (ตามแบบ `memoryDevTools`) + ภายหลังทำปุ่ม "ตรวจ/ซ่อมการตั้งค่า" ใน ตั้งค่า (UI = งานแยก)

### blob ที่ลงทะเบียน (ค่าเริ่มต้น)
`atom.modules.v1.enabled` · `atom.ai.v1.customProviders` · `atom.mcp.v1.servers` · `atom.skills.v1` · `atom.voice.v1.standby` · ProviderSettings blob
→ **ไม่แตะ**: คีย์ลับใน SecureStore, chat history (ข้อมูลผู้ใช้ — ลบไม่ได้เงียบ ๆ), `atom.snapshots.v1`/`atom.repair.log.v1` เอง

### ความปลอดภัย / ข้อควรระวัง (ขอ architect ช่วยดู)
- reset ของ blob = "ลบค่าที่บอสเคยตั้ง" → ควร snapshot เสมอ (ทำแล้ว) + log ให้เห็นว่าซ่อมอะไรไป · ควรแจ้งบอสในแชทไหมเมื่อ boot ซ่อมของจริง? (เสนอ: ใส่ system message สั้น ๆ)
- ไม่ควรกู้ history/secret อัตโนมัติ (เสี่ยงลบของมีค่า) — จึงตัดออกจากทะเบียน
- single-user · ลูปซ่อมไม่ควรวน: ซ่อม 1 รอบต่อ boot เท่านั้น

### เทสต์
- SettingsHealth: blob เสีย → repair ถูกเรียก + snapshot ถูกสร้าง + ค่าเป็น default · blob ปกติ → ไม่แตะ
- boot: inject fake storage เสีย → boot ไม่ reject + ซ่อมแล้ว

---

## TASK 5 — ย้ายของออกจากแกนตาม CORE_AUDIT (ทีละโมดูล · แต่ละชิ้น = PR เล็ก)

> หลัก: ย้ายแล้ว **แกนยังคุย/ฟัง/พูด/จำ/สลับ persona ได้** · `architecture.test.ts` คุม core↛features · feature test เดิมต้องเขียว · โค้ดที่บอสเขียนเองไม่แตะ

### ลำดับที่เสนอ (เล็ก→ใหญ่, เสี่ยงน้อย→มาก)
1. **`supermemory`** (`core/memory/{SuperMemorySync,SecretSync}`) → module `supermemory` · ค่อนข้างแยกเดี่ยว (boot เรียก subscribe + importOnce) · ปิดแล้วแกนยังจำในเครื่องได้ → **เริ่มชิ้นนี้ก่อน**
2. **`mark55-sync`** (`core/memory/{RemoteMemoryAdapter,SyncQueue,MemorySync}` + `core/chat/*` + `features/chat/chatSyncBridge`) → module
3. **`mark55-bus`** (`features/pc-bridge/*` + `modules/pc-inbox.ts`) → module
4. **`device-control`** (`core/agent/DeviceControlBridge` + `modules/agents/{device-agent,confirmations,thaiNumber}`) → module (native `atom-device` ยังอยู่ใน APK)
5. **`standby`** (`modules/agents/standby-agent`) → module · **`ultron`** (`modules/agents/ultron-agent`) → module

### รูปแบบการย้าย (เหมือนกันทุกชิ้น)
- สร้าง `src/modules/<name>/` ที่ห่อของเดิมเป็น `AtomModule` (register/init/teardown) ลงทะเบียนผ่าน `moduleManager`
- boot: แทนการเรียกตรง → `moduleManager` เปิด/ปิดได้ (จำค่าใน `atom.modules.v1.enabled`) · ค่าเริ่มต้น "เปิด" เพื่อไม่เปลี่ยนพฤติกรรมเดิม
- ย้ายไฟล์แบบคง public API (re-export ที่เดิมถ้ามีคนใช้) → ลด churn ของ import
- ต่อ PR: `npm test` + `tsc` + `architecture.test.ts` เขียว

### คำถามถึง architect
- ชิ้นที่ควรยังอยู่ใกล้แกน: `task-agent` (ทางเข้า AgentHarness) — เห็นด้วยไหมที่คงไว้?
- provider pack (Gemini/OpenRouter/Dahl/xAI/TTS/STT) ตาม CORE_AUDIT = "รายการในคลัง ไม่ใช่โค้ดล็อก" — ย้ายตอนนี้เลย หรือเฟสหลัง? (กระทบไฟล์เยอะ)
- ชิ้นที่ 1 (`supermemory`) — เริ่มได้เลยไหม หรืออยากจัดลำดับใหม่?

---

## ลำดับลงมือ (เมื่อเคาะแล้ว)
1. task 4: SettingsHealth + boot pass + dev tool (+ ถามเรื่องแจ้งบอสเมื่อซ่อม)
2. task 5 ชิ้นที่ 1: module `supermemory`
3. ไล่ task 5 ทีละชิ้นตามลำดับ · แต่ละชิ้นรีวิว+เทสต์
4. ครบแล้ว → Voice B (Gemini Live) = ร่าง design แยก (ระบบใหม่)
5. จบแกน → แจ้งทีม + build APK ครั้งเดียว
