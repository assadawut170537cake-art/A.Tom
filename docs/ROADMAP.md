# ROADMAP — สถานะงานที่เดินแบบวนลูป (Boss สั่ง 2026-10-20: ทำ→รีวิว→แก้→ถัดไป จนเสร็จจริง)

> ไฟล์นี้ = สถานะจริงของลูป · อัปเดตทุกครั้งที่จบ/เริ่มงานย่อย · เรียงตาม `docs/CONCEPT.md`
> เสร็จครบแกน → แจ้งทีม + build APK ครั้งเดียว · เจอด่านอนุมัติ = หยุดถามบอส (ไม่เปิดใช้เอง)

## แกนหลัก (CONCEPT)

| # | งาน | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| 1 | คุยลื่น (Voice A: สตรีมเสียง/พูดทีละประโยค/end-of-speech ไว) | ✅ เสร็จ + ผ่านรีวิว | SILENCE 900ms · splitSentences · fallback ครบทุกประโยค · Voice B (Gemini Live) = งานใหญ่รอบหลัง |
| 2 | ส่งงานต่อให้แอปอื่น (เสียง → เรียก tool/agent) | ✅ เสร็จ (ตรวจแล้ว) | router→agent (agentRouter.test) + sendMessage พูด reply ทุก intent (persona.test) ครอบคลุมแล้ว · ไม่ต้องเพิ่มโค้ด |
| 3 | หาความสามารถเอง | ✅ เสร็จ | `find_capability` (ค้นคลัง MCP, read-only) · "เขียนทักษะเอง" = **Boss อนุมัติแล้ว 2026-10-20** → `learn` เปิดเป็นค่าเริ่มต้น (`SkillEngine.isLearnEnabled`) · ทักษะที่ AI เขียนยัง `enabled:false` รอบอสเปิดใน Marketplace (เนื้อหาผ่าน toPromptLine redact) |
| 4 | ซ่อมตัวเอง + เรียนรู้ | ✅ เสร็จ (ตั้งค่า/ข้อมูล) | engine (`SnapshotStore`/`SelfRepair`) + `SettingsHealth` (Q1 ครบ) + **ต่อ boot แล้ว** (ตรวจ 5 blob ก่อน module start → ซ่อมมีผลรอบนี้เลย · แจ้งบอสในแชท) · เหลือ nice-to-have: UI ดู quarantine/learn-toggle · แก้โค้ด/OTA = **ด่านอนุมัติ** |
| 5 | ย้ายของเสริมออกจากแกน (CORE_AUDIT) | 🔄 กำลังทำ | ✅ **PR-5.1** `supermemory` → module เปิด/ปิดได้ (boot เดิมเรียกตรง → ย้ายไป `module.init`/`dispose` · ค่าเริ่มต้นเปิด) · ⏳ PR-5.2 `mark55-sync` · 5.3 `mark55-bus` · 5.4 `device-control` · 5.5 `standby`/`ultron` · task-agent คงใน core (DeepSeek) |

## ด่านที่ต้องรอบอสอนุมัติ (ไม่เปิดใช้เอง — สร้างโครงปิดไว้ได้)
- ทักษะที่ AI เขียนเอง (`learn`) เข้า prompt · เพิ่ม/เปิด MCP ใหม่ · แก้โค้ดตัวเองผ่าน OTA
- ❌ offensive / uncensored ของอัลตรอน = ไม่ทำ

## ของเสริม (หลังแกน)
Gemini Live realtime · Supermemory เป็นช่องสื่อสารกลาง · Daily Researcher (เวอร์ชันเบา รอบอสสั่งตั้ง) · Mark 55 / PC · อื่น ๆ ตาม CORE_AUDIT
