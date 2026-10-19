# A.T.O.M. — สิ่งที่บอสต้องทำ (หลัง session 2026-10-19)

> สรุปงานที่ Claude ทำไปทั้งหมด + ขั้นตอนที่บอสต้องทำเองฝั่ง Mark 55 / Supabase / Supermemory
> ของในแอปทำงานได้เองอยู่แล้วแม้ยังไม่ตั้งค่าด้านล่าง (ไม่ตั้ง = ฟีเจอร์นั้นเงียบ ไม่พัง)

## รวมเข้า main แล้ว (session นี้)

| # | งาน |
|---|-----|
| #21 | ควบคุมมือถือระดับ B (AccessibilityService) + ฟังเสียงตอนอยู่แอปอื่น + เลขไทย |
| #22 | AgentHarness ต่อเข้าแชท (agent "งาน" — สั่งงานหลายขั้น) |
| #23 | โหมดเฝ้า (อัลตรอน) + PC → มือถือ (NOTIFY/DEVICE_TOOL) |
| #24 | อัลตรอน sandbox (รันโค้ดใน Docker + ปลด/ทำลาย) |
| #25 | ห้องแชทเดียวกัน PC ↔ มือถือ (ซิงก์ประวัติแชท) |
| #26 | ดึง API key จาก Supermemory มาใส่ SecureStore อัตโนมัติ |

⚠️ ทั้งหมด **ยังไม่ได้ทดสอบบนเครื่องจริง** (เทสอัตโนมัติ + compile + Docker/Postgres จริงในคลาวด์ผ่านแล้ว)

## ขั้นตอนที่บอสต้องทำเอง

### 1. Supabase — รัน SQL (ครั้งเดียว)
เปิด Supabase → SQL Editor → รันตามลำดับ (รันซ้ำได้ ไม่เสียหาย):
- `mark55/sql/003_mobile_inbox.sql` — ช่องทาง PC → มือถือ (NOTIFY / DEVICE_TOOL)
- `mark55/sql/004_ultron.sql` — คำสั่งอัลตรอน (ULTRON_RUN/RELEASE/DESTROY) + ขยาย payload เป็น 16 KB

(`001` / `002` รันไปแล้วตั้งแต่ก่อนหน้า)

### 2. Mark 55 (PC) — Docker + โค้ด Python
- ติดตั้ง **Docker Desktop** แล้วเปิดไว้ · ครั้งแรกรัน `docker pull python:3.12-slim`
- ดึงโค้ด Mark 55 ล่าสุด (มีไฟล์ใหม่: `mark55/ultron_sandbox.py`, `mark55/mobile_outbox.py`, handler อัลตรอน)
- เปิด watcher ใหม่: `python main.py` (ในโฟลเดอร์ mark55) — handler อัลตรอนลงทะเบียนเอง
- ต้องมี endpoint `/api/v1/chat/sync` บน Mark 55 สำหรับ "ห้องแชทเดียวกัน" (ยังไม่มีโค้ด server ในนี้ — ถ้า field ไม่ตรง แก้ที่ `src/core/chat/RemoteChatAdapter.ts` ที่เดียว)

### 3. Supermemory — เก็บ API key (ครั้งเดียว)
- สร้าง space `project_atom_memory_base_4folders_atom_secrets`
- เพิ่ม document เก็บคีย์ บรรทัดละ `ชื่อคีย์ = ค่า` เช่น:
  ```
  ai.gemini = AIza...
  ai.openrouter = sk-or-...
  tts.elevenlabs = ...
  stt.openai = sk-...
  ```
  (ชื่อคีย์ = `secretKey()` ของ SecureKeyStore · รับเฉพาะ `ai. / tts. / stt. / mcp. / pcbridge.`)
- ในแอป: ตั้งค่า › Sync → ใส่ Supermemory API key (ตัว bootstrap) → กด "ดึงคีย์มาใส่เครื่อง" (หรือรอ boot ดึงเอง)

### 4. บนมือถือ (เปิดสิทธิ์เอง)
- ตั้งค่าเครื่อง › การช่วยเหลือพิเศษ › "A.T.O.M. ควบคุมเครื่อง" (ระดับ B)
- ตั้งค่า › Marketplace › เปิด "ควบคุมอุปกรณ์"
- จับคู่ Mark 55 ที่ ตั้งค่า › Sync (Server URL + รหัส 6 หลัก) → เปิดใช้ทั้ง memory sync · ห้องแชทเดียวกัน · PC→มือถือ
- ออก token เครื่องสำหรับ Mark 55 Bus (ดู `mark55/README.md`)

## ทดสอบบนเครื่องจริงที่ยังค้าง
- ระดับ B: "เปิดแอป LINE แล้วกด แชท" · ปุ่มเสี่ยงต้องพิมพ์ "ยืนยัน"
- โหมดเฝ้า: "เปิดโหมดเฝ้า" → สลับไปแอปอื่น → "อัลตรอน ปรับเสียง 30"
- อัลตรอน sandbox: "อัลตรอน ทำว่า สุ่มเลข 6 หลัก" → "ปลด" / "ทำลาย"
- ห้องแชทเดียวกัน: พิมพ์ที่มือถือ เห็นที่ PC (และกลับกัน)

## ยังไม่ได้ทำ (รอบอสสั่ง)
- **จาร์วิส** — รับสาย/เข้าประชุม = สั่งงาน (งานใหญ่, ยังไม่เริ่ม)
- **iPhone สำรอง** — build ฟรีผ่าน GitHub Actions + AltStore (ยังไม่เริ่ม)
