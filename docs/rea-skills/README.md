# ชุดสกิล REA สำหรับ A.T.O.M.

สกิล (Agent Skill — `SKILL.md` + frontmatter) ที่สอนผู้ช่วยให้ใช้ **REA** แกะแอปเพื่อช่วยอะตอม
หาช่องทางควบคุมแอปอื่น. หนึ่งสกิลหนึ่งโฟลเดอร์ — วางลง `.claude/skills/` ของ client ได้เลย.

| สกิล | ทำอะไร | ต้องมี |
|---|---|---|
| `rea-setup` | ติดตั้ง REA + JADX + apktool + adb ให้ `rea doctor` เขียว | Node 22+, JDK 17+ |
| `rea-android-doors` | แกะ APK หา exported/deep link/intent-filter (ทางเข้าแอป) | rea-setup (JADX+apktool) |
| `rea-adb-grab` | ดึงแอปจากมือถือที่ติดตั้งแล้ว + ดู/สั่งแอปที่รันผ่าน adb | rea-setup + REA_ADB_PATH + มือถือ |
| `rea-js-electron` | แกะแอป JS/Electron/เว็บ static (ไม่ต้องมี engine) | rea-setup |
| `rea-atom-bridge` | ต่อ REA เข้าอะตอมผ่าน Mark 55 Bus (แผนเขียนโค้ด) | เข้าใจ pc-bridge |

## ติดตั้ง
แตก zip ลงในโฟลเดอร์สกิลของ client เช่น:
```bash
unzip rea-skills.zip -d ~/.claude/skills/        # จะได้ ~/.claude/skills/rea-setup/SKILL.md ฯลฯ
```
หรือก๊อปทีละโฟลเดอร์. แต่ละสกิลเป็นอิสระ — ลงเฉพาะที่ใช้ก็ได้.

## สกิล vs MCP — ใช้ควบคู่ ไม่ใช่เลือกอย่างใดอย่างหนึ่ง
- **MCP (`rea mcp add`)** = ให้ *เครื่องมือ* (rea commands) แก่ agent โดยตรง ลงครั้งเดียวได้ทุกคำสั่ง อัปเดตตามเวอร์ชัน REA
- **สกิลชุดนี้** = ให้ *วิธีคิด/ขั้นตอน* (เลือกคำสั่งไหน ลำดับไหน แปลผลยังไง กันพลาด/กัน injection) สำหรับเป้าหมายของอะตอม
- บน PC (Claude Code/Codex): **MCP + สกิล** ดีสุด · ฝั่งแอปมือถือต่อ MCP ตรงไม่ได้ → ใช้สกิล `rea-atom-bridge` ผ่าน Bus

รายละเอียดแผนเต็ม: [`../REA_INTEGRATION.md`](../REA_INTEGRATION.md) (ADR-016).
