---
name: rea-atom-bridge
description: ต่อความสามารถ "แกะแอป" ของ REA เข้ากับ A.T.O.M. ให้สั่งจากแชท/เสียงบนมือถือได้ ผ่าน Mark 55 Bus เดิม (ไม่ต่อ MCP เข้ามือถือ ไม่เพิ่ม dependency ในแอป RN). ใช้เมื่อจะลงมือเขียนโค้ดเชื่อม REA กับอะตอม ตามแผน docs/REA_INTEGRATION.md (ADR-016).
---

# rea-atom-bridge — ต่อ REA เข้าอะตอมผ่าน Mark 55

REA รันบน **PC (Mark 55)** — เป็น stdio MCP + ต้องมี Java/engine. แอป A.T.O.M. (React Native)
ต่อ MCP ตรงไม่ได้ (`MCPClientBridge` รับแค่ Streamable HTTP). จึงสั่งผ่าน **Memory Bus เดิม**
(`pc-bridge`) เหมือนอัลตรอน sandbox: มือถือสั่ง → PC รัน rea → ผลกลับทาง NOTIFY.

> อ้างอิง: `docs/REA_INTEGRATION.md`, ADR-016, และ CLAUDE.md §"Mark 55 Bus". **ต้องให้ Boss อนุมัติก่อน**
> (เข้าข่าย "เปลี่ยน arch" ตาม CLAUDE.md §11). อย่าเพิ่ม dependency ในแอป RN · อย่าแตะ lock/stack.

## ทางเดิน
```
แชท/เสียง → agent "แกะแอป" (regex) → PC_COMMANDS: REVERSE_ENGINEER
         → Memory Bus (Supabase RPC) → Mark 55 handler → `rea …` → สรุปผล → NOTIFY → แชท
```

## 3 จุดที่ต้องแก้ (ตามรูปแบบที่ repo มีอยู่แล้ว)

### 1) มือถือ — agent "แกะแอป" (`src/modules/agents/`)
- ทำตาม `device-agent.ts` / `ultron-agent.ts`: regex **แคบ** ขึ้นต้นประโยค
- ตัวอย่าง: `/^(แกะแอป|หาทางเข้า|วิเคราะห์แอป)\s+(.+)/` · `"แอป … มี deep link อะไรบ้าง"`
- เลี่ยงคำว่า "เครื่อง/คอม" (RuleClassifier แย่งเป็น `pc_command`) → ใช้ "แอป"/"มือถือ"
- ลงทะเบียนใน `bootApp()` · ให้มา **หลัง** agent ที่แคบกว่า (device/task) เพื่อไม่ชน "เปิดแอป X แล้วกด Y"
- agent ล้มต้องตอบข้อความไทย ไม่ throw (AgentHandler pattern)

### 2) มือถือ — `features/pc-bridge/commands.ts`
เพิ่มใน `PC_COMMANDS`:
```ts
{ instruction: 'REVERSE_ENGINEER', label: 'แกะแอป',
  pattern: /แกะแอป|หาทางเข้า|วิเคราะห์แอป|deep ?link/i },
```
payload (≤ 500 B): `{ text, target: '<ชื่อแอป/พาธ apk>' }`.

### 3) PC — `mark55/handlers.py` + SQL
```python
def handle_reverse_engineer(task):
    # ต้องไม่ raise — จับ error เองคืน dict ที่มี status
    # 1) resolve target: ชื่อแอป → resolve-adb-packages → pull-adb-package  (หรือพาธ apk ที่ส่งมา)
    # 2) subprocess: rea inspect-android-package <apk> --format json  (+ decode-android-resources)
    # 3) parse manifest → exported components + intent-filter + deep link
    # 4) return {"status":"OK","doors":[...],"evidence_id":...}
```
- ลงทะเบียนใน `HANDLER_REGISTRY`
- เพิ่ม `REVERSE_ENGINEER` ในชุด instruction ที่ RPC อนุญาต (`mark55/sql/002_mobile_rpc.sql` —
  ทำแบบเดียวกับ `RUN_DIAGNOSTICS`/`EXECUTE_BUILD`) · **ห้ามเปิด policy ให้ anon**
- `describeResult()` ใน commands.ts สรุป `doors` เป็นข้อความไทยสั้น ๆ

## ความปลอดภัย (บังคับ)
- ผลจากแอปเป้าหมายที่จะ **เข้า prompt** ต้องผ่าน `redactSecrets()` + `toPromptLine()` (กัน injection — ดู CLAUDE.md §Security).
- REA แค่ "บอกช่องทาง" ไม่ลงมือ — การยิง intent/deep link ที่เข้าข่ายอันตราย (ซื้อ/โอน/ลบ/ส่ง)
  ยังต้อง `needsConfirmation` → ผู้ใช้พิมพ์ "ยืนยัน" (ใช้ `deviceConfirmations` ร่วม).
- แกะได้เฉพาะแอปที่ Boss มีสิทธิ์ · ทำงานในเครื่อง ไม่ส่งไฟล์เป้าหมายออกเน็ต.

## ตรวจก่อน commit (CLAUDE.md §7)
`npm test` · `npx tsc --noEmit` · `npx expo lint` · (handler: `python -m unittest` ใน `mark55/`).
commit แยก sub-phase · scope `phase4`/`router`/`core`.
