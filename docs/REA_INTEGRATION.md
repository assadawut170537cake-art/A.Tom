# แผนนำเข้า REA เข้า A.T.O.M. (ความสามารถ "แกะแอป")

> REA = **Reverse Engineer Anything** (`rea-agents`, MIT, repo `morluto/rea`)
> CLI + MCP ตัวเดียวที่แกะได้ทั้ง native binary, JavaScript/Electron, .NET, **APK Android**,
> Flutter, firmware, เว็บไซต์ และดูพฤติกรรมตอนรัน (Frida/gdb) — ทำงานในเครื่อง ทุกข้อสรุปแนบหลักฐาน
>
> เอกสารนี้เป็น **แผน** (ยังไม่แก้โค้ดแอป) — ต้องให้ Boss อนุมัติก่อนลงมือ ตาม CLAUDE.md §11

---

## 1. ทำไมอะตอมต้องมีความสามารถนี้

เป้าหมาย ADR-015: อะตอม "ควบคุมมือถือได้เกือบ 100%" ผ่าน AccessibilityService (ระดับ B)
— แตะ/พิมพ์/อ่านจอ, เปิดแอป, ส่ง intent ได้ **แต่ระดับ B ตอบได้แค่ "ทำยังไง" ไม่ตอบ "มีอะไรให้ทำบ้าง"**

ปัญหาที่เจอจริงตอนสั่งแอปอื่น:
- ไม่รู้ว่าแอปเป้าหมายมี **ทางเข้า** อะไรบ้าง — exported activity, deep link / URL scheme, intent-filter, service, content provider
- ต้อง "เปิดแอป X แล้วกด Y" แบบเดาปุ่มจากข้อความบนจอ ซึ่งเปราะ (จอเปลี่ยน ข้อความเปลี่ยน = พัง)
- ไม่รู้ว่ามี deep link ตรงไปหน้าที่ต้องการไหม (เร็วและนิ่งกว่าการไล่กดทีละจอมาก)

**REA เติมส่วนที่ขาด:** แกะ APK ของแอปเป้าหมายแบบ static (ไม่ต้องรันแอปนั้น) แล้วบอกว่า
"แอปนี้มีประตูอะไรให้สั่งได้บ้าง" → อะตอมเอาผลนั้นมาวางแผนคำสั่งระดับ B ได้แม่นขึ้น
หรือยิง intent / deep link ตรง ๆ แทนการไล่กดจอ

> REA เป็นเครื่องมือ **ช่วยวางแผน/ให้ข้อมูล** ไม่ใช่ตัวลงมือแทน — ผลที่ได้คือ "หลักฐาน" (evidence)
> การลงมือจริงยังผ่านระดับ A/B เดิม และคำสั่งอันตรายยังต้อง "ยืนยัน" ตาม ADR-015

### ขอบเขตอำนาจ (สำคัญ)
- แกะได้เฉพาะ APK/แอปที่ **บอสมีสิทธิ์วิเคราะห์** (แอปของบอสเอง, โอเพนซอร์ส, หรือที่ได้รับอนุญาต)
- ทำงาน **ในเครื่อง PC เท่านั้น** ไม่ส่งไฟล์เป้าหมายออกเน็ต
- ใช้เพื่อ **ต่อเชื่อม/สั่งงานแอปบนเครื่องของบอส** ไม่ใช่เจาะ/ข้ามการป้องกันของบริการคนอื่น

---

## 2. REA อยู่ตรงไหนของสถาปัตยกรรม — **บน PC (Mark 55) ไม่ใช่ในแอป RN**

| | REA | A.T.O.M. (แอปมือถือ) |
|---|---|---|
| รูปแบบ | CLI + **MCP แบบ stdio** (Node ≥ 22) | React Native (Hermes/JS engine) |
| ต้องมี | Java (JDK 17+) + JADX jar / apktool · engine native เป็น bring-your-own | — |
| เชื่อมแบบ | subprocess / stdio | `MCPClientBridge` รับได้แค่ **Streamable HTTP JSON-RPC ผ่าน https/localhost** |

**ต่อ MCP ของ REA เข้ามือถือตรง ๆ ไม่ได้** เพราะ `MCPClientBridge` (ดู CLAUDE.md §Agent Harness)
คุยได้แค่ HTTP ส่วน REA เป็น stdio + ต้องมี JRE/engine ที่มือถือไม่มี

→ **ที่ถูกต้องคือ: REA ติดตั้งบน PC ที่รัน Mark 55 แล้วมือถือสั่งผ่าน Memory Bus เดิม** (`pc-bridge`)
เหมือนที่อัลตรอน sandbox ทำอยู่แล้ว (LLM บนมือถือสั่ง → PC รัน Docker → ผลกลับ) — ใช้ทางเดิมซ้ำได้เลย

```
แชท/เสียงบนมือถือ
  → agent "แกะแอป" (regex)        [ใหม่ ใน src/modules/agents/]
  → PC_COMMANDS: REVERSE_ENGINEER [ใหม่ ใน features/pc-bridge/commands.ts]
  → Memory Bus (Supabase RPC เดิม)
  → Mark 55 handler: handle_reverse_engineer [ใหม่ ใน mark55/handlers.py]
  → subprocess: `rea inspect-android-package <apk> --format json`
  → สรุปผล (ทางเข้า/deep link/exported) กลับทาง NOTIFY → แชทมือถือ
```

ไม่ต้องเพิ่ม dependency ใด ๆ ในแอป RN · ไม่แตะ tech stack · ไม่ลงอะไรใน APK

---

## 3. ติดตั้ง REA บนเครื่อง (ทำบน PC ของบอส / Mark 55)

เวอร์ชันตรวจแล้วใน container นี้: `rea-agents@6.7.0`, Node 22.22, JDK 21

```bash
# 1) ติดตั้ง CLI + MCP
npm install --global rea-agents@latest        # ได้คำสั่ง `rea`

# 2) ลงทะเบียน MCP ให้ agent (ครั้งเดียว) — ทางเลือก ถ้าจะให้ Claude Code/Codex เรียกตรง
rea mcp add --agent claude-code

# 3) ชุดเครื่องมือ Android (สำหรับสั่งจาก Mark 55) — bring-your-own ตาม REA
#    JADX (ยืนยัน SHA-256 ตาม metadata ของ REA):
mkdir -p "$HOME/.local/share/rea/android" && cd "$_"
curl -fL -o jadx-headless-mcp-0.7.1-all.jar \
  https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar
echo '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75  jadx-headless-mcp-0.7.1-all.jar' | sha256sum -c -
export REA_JADX_MCP_JAR="$PWD/jadx-headless-mcp-0.7.1-all.jar"

#    apktool (decode manifest/resources):
export REA_APKTOOL_COMMAND="/absolute/path/apktool"   # 2.9.3+ (เลี่ยง CVE) — ดู docs/apktool-resource-analysis.md

# 4) ตรวจความพร้อม
rea doctor
```

> engine native (Hopper/Ghidra/IDA) เป็น **ของเสริม** — จำเป็นเฉพาะตอนแกะ binary native
> สำหรับงาน "หาทางเข้าแอป Android" ใช้แค่ **JADX + apktool** ก็พอ (ไม่ต้องลง Hopper/Ghidra)
> REA **ไม่** ลง Java/Android SDK/JADX/Ghidra ให้ — ต้องเตรียมเอง (นโยบายของ REA เอง)

สถานะใน container นี้ (ทดสอบแล้ว 2026-10-20): ✅ `rea` ใช้ได้ · ✅ apktool 3.0.3 + JADX 0.7.1 ผ่าน
`inspect-apktool-client` · ✅ แกะ `inspect-android-package` / `decode-android-resources` กับ APK
สาธารณะ (NewPipe 0.29.1) สำเร็จ คืน manifest + permissions + class/resource count พร้อม evidence id

---

## 4. คำสั่ง REA ที่อะตอมจะใช้ (map กับความต้องการ)

| ต้องการ | คำสั่ง REA | ได้อะไร |
|---|---|---|
| ทางเข้าแอป + สิทธิ์ | `inspect-android-package <apk>` | decoded manifest, permissions, min/target SDK, signature, class count |
| deep link / intent-filter / exported | `decode-android-resources <apk>` | manifest + resources ละเอียดจาก apktool |
| หาคลาส/หน้าจอที่สนใจ | `search-android-classes <apk> <ชื่อ>` | รายชื่อคลาสที่ตรง |
| ดูโครง/เมธอดของคลาส | `inspect-android-class` / `inspect-android-method` | member/decompile ของเมธอด |
| ใครเรียกอะไร (ลากเส้น) | `trace-android-references <apk> <class/method>` | incoming references |
| โปรเจกต์เป็นกราฟทั้งแอป | `project-android-application-graph` | inventory เป็นกราฟ |

### แกะจากแอปที่ติดตั้งในมือถือโดยตรง (adb) — ไม่ต้องหาไฟล์ APK มาก่อน
Android เก็บ APK ของทุกแอปในเครื่อง → REA ดึงออกมาแล้วแกะได้เลย (ต้องรันบน **PC ที่ต่อมือถือ** — มือถือเปิด USB debugging + กด "อนุญาต")

```bash
export REA_ADB_PATH=/absolute/path/adb          # Android platform-tools (REA ไม่ลงให้)
rea inspect-adb-client                           # ตรวจว่า adb พร้อม
rea list-adb-devices                             # มือถือต่ออยู่ไหม (serial/state)
rea resolve-adb-packages line                    # หา package จากชื่อ เช่น "line"
rea pull-adb-package com.example.app /out/dir    # ดึง APK set ออกมา (พร้อม SHA-256)
rea inspect-android-package /out/dir/base.apk    # แกะต่อ (เหมือน §4 ด้านบน)
```

**adb ยังดูแอปที่กำลังรันจริงได้** — ตอบโจทย์อะตอมมากเพราะบอก "ตอนนี้อยู่หน้าไหนของแอปอะไร":

| คำสั่ง adb | ใช้ตอน |
|---|---|
| `inspect-adb-window` | แอปไหนอยู่หน้าสุด + activity ปัจจุบัน → อะตอมรู้ว่ากำลังดูอะไรอยู่ |
| `inspect-adb-package <pkg>` | เวอร์ชัน/installer/flag ของแอปที่ติดตั้ง |
| `list-adb-packages` / `resolve-adb-packages` | แอปอะไรติดตั้งบ้าง |
| `start-adb-activity` | ยิง intent / เปิด activity ตรง ๆ (จากทางเข้าที่ §4 หาได้) |
| `read-adb-logcat` · `capture-adb-screen` · `list-adb-services` | ดู log / จับภาพจอ / binder services |

> **แผนที่ครบของอะตอม:** `inspect-adb-window` (อยู่หน้าไหน) + `pull-adb-package` → `inspect-android-package`
> (ทางเข้าทั้งหมด) → เลือกยิง `start-adb-activity`/deep link ตรง ๆ หรือวางแผนคำสั่งระดับ B ให้แม่น
>
> ข้อจำกัด adb: แอปที่ตั้ง flag ห้ามดึง หรือแอประบบบางตัว pull ไม่ได้ · ยังเป็น Android เท่านั้น (iOS ไม่มี adb)
> · container cloud นี้ไม่มี adb + ไม่มีมือถือต่อ จึงทดสอบ adb-pull ไม่ได้ (ต้องทำบน PC ของบอส)

**เอาต์พุตที่อะตอมต้องการจริง** = จาก decoded manifest ดึง:
`<activity>/<activity-alias>/<service>/<receiver>` ที่ `exported=true` + `intent-filter`
(`action`, `category`, `data` = scheme/host/path) → นี่คือ "ประตู" ที่สั่งผ่าน `am start` /
deep link / ระดับ B ได้ · ทุกคำสั่งรองรับ `--format json` ให้ handler parse ต่อได้

---

## 5. งานที่ต้องทำในฝั่งโค้ด (3 จุด ตามทางเดินใน §2)

### 5.1 มือถือ — เพิ่ม agent "แกะแอป" (`src/modules/agents/`)
- ตาม pattern ของ agent "อุปกรณ์"/"อัลตรอน" (regex แคบ ขึ้นต้นประโยค)
- ตัวอย่างคำสั่ง: `"แกะแอป <ชื่อ/พาธ APK>"` · `"หาทางเข้าแอป <...>"` · `"แอป <...> มี deep link อะไรบ้าง"`
- ลงทะเบียนใน `bootApp()` · **ต้องมาหลัง** agent ที่แคบกว่า ไม่ชนคำว่า "เปิดแอป X แล้วกด Y" (นั่นเป็นของ agent อุปกรณ์)
- ระวังคำว่า "เครื่อง/คอม" ที่ RuleClassifier แย่งเป็น `pc_command` (CLAUDE.md §Agent Harness) → ใช้ถ้อยคำที่ขึ้นต้นด้วย "แกะ/วิเคราะห์"

### 5.2 มือถือ — เพิ่มคำสั่งใน `features/pc-bridge/commands.ts`
```ts
{ instruction: 'REVERSE_ENGINEER', label: 'แกะแอป',
  pattern: /แกะแอป|หาทางเข้า|reverse|deep ?link|วิเคราะห์ ?apk/i },
```
payload = `{ target: <ชื่อแอป/พาธ apk>, mode: 'android-doors' }` (ตัด ≤ 500 B ตามเดิม)

### 5.3 PC — เพิ่ม handler ใน `mark55/handlers.py`
```python
def handle_reverse_engineer(task):
    # 1) resolve target → absolute APK path (จาก pull-adb-package หรือพาธที่บอสให้)
    # 2) subprocess: rea inspect-android-package <apk> --format json  (+ decode-android-resources)
    # 3) parse manifest → ดึง exported components + intent-filters + deep links
    # 4) return {"status": "OK", "doors": [...], "evidence_id": ...}
    # ห้าม raise — จับ error เองคืน dict (ดู docstring ของ handlers.py)
```
+ ลงทะเบียนใน `HANDLER_REGISTRY` + เพิ่ม `REVERSE_ENGINEER` ในชุด instruction ที่ RPC อนุญาต
(SQL `mark55/sql/002_mobile_rpc.sql` — ทำแบบเดียวกับที่เพิ่ม `RUN_DIAGNOSTICS`)

> โค้ด Mark 55 อยู่นอก repo นี้บางส่วน แต่โครง handler/SQL อยู่ใน `mark55/` แล้ว — แก้ตามรูปแบบเดิม

---

## 6. ความปลอดภัย / ข้อควรระวัง (ตาม CLAUDE.md §Security + ADR-015)

- **ผลจาก REA เข้า prompt?** ถ้าจะแนบผล (ชื่อคลาส/ข้อความจากแอป) เข้า LLM ต้องผ่าน `redactSecrets()`
  และบีบบรรทัดเดียวด้วย `toPromptLine()` เหมือน memory fact (กัน prompt injection จากเนื้อหาในแอปเป้าหมาย)
- **ไม่ auto-act:** REA บอก "มีประตูอะไร" เฉย ๆ · การยิง intent/deep link ที่เข้าข่ายอันตราย
  (ซื้อ/โอน/ลบ/ส่ง) ยังต้อง `needsConfirmation` → บอสพิมพ์ "ยืนยัน" (ใช้ `deviceConfirmations` เดิม)
- **ขอบเขตไฟล์:** handler รับเฉพาะพาธ APK ที่ชัดเจน · ดึง APK จากเครื่องบอสเองผ่าน `pull-adb-package` ได้
- **ไม่ลง dependency ใหม่ในแอป RN · ไม่แตะ lock decisions · ไม่ reformat** — ทุกอย่างเกิดบน PC

---

## 7. ลำดับทำ

1. **(เอกสารนี้)** ✅ ติดตั้ง + พิสูจน์ REA แกะ APK ได้จริง + วางแผน
2. PC: ติดตั้ง REA + JADX + apktool บนเครื่อง Mark 55 ให้ `rea doctor` เขียว (ข้อ §3) — ทำตอนลงจริง
3. ✅ PC: handler `make_rea_handler` (`mark55/reverse_engineer.py`) + SQL `005_reverse_engineer.sql` + test (`mark55/test_reverse_engineer.py`, 8 เคสผ่าน)
4. ✅ มือถือ: agent "แกะแอป" (`src/modules/agents/rea-agent.ts`, `REA_AGENT_ID='rea'`) + ลงทะเบียนใน `bootApp()` + test (`src/__tests__/reaAgent.test.ts`, 15 เคสผ่าน) — ตอบ "ประตู" ที่เจอเป็นข้อความไทย
5. ต่อยอด (ยังไม่ทำ): ให้ agent "งาน" (AgentHarness) เรียกผลนี้ไปวางแผนคำสั่งระดับ B อัตโนมัติ

> หมายเหตุ: ใช้แนวทาง **agent เฉพาะ** (เหมือนอัลตรอน) ไม่ได้เพิ่มใน `PC_COMMANDS`/`PcBridgeModule`
> เพราะ "แกะแอป" เป็น intent `agent` (submit `REVERSE_ENGINEER` เข้า Bus ตรง ๆ) ไม่ใช่ `pc_command`.
> handler ปัจจุบันเติม `doors` จาก manifest; การ redact/บีบก่อนเข้า prompt ยังเป็นงานต่อเมื่อผล REA
> ถูกแนบเข้า system prompt ของ persona (ตอนนี้ตอบเป็นข้อความแชทเฉย ๆ ยังไม่เข้า prompt).

---

## 8. สรุปสั้น

- REA = ตาให้อะตอม "มองเข้าไปในแอปอื่น" เพื่อรู้ช่องทางควบคุม (ส่วนที่ระดับ B เดายาก)
- ติดตั้งบน **PC/Mark 55** สั่งผ่าน **Bus เดิม** — มือถือไม่ต้องเพิ่ม dep, ไม่แตะ stack
- งานฝั่งโค้ด = 3 จุดเล็ก ๆ (agent + PC_COMMANDS + Mark 55 handler) ตามรูปแบบที่ repo มีอยู่แล้ว
- ทุกอย่างในเครื่อง + มีหลักฐาน + ไม่ลงมือแทน + คำสั่งอันตรายยังต้องยืนยัน
