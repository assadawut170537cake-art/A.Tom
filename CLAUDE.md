# CLAUDE.md — A.T.O.M. Project Rules

> ไฟล์นี้ Claude Code อ่านทุก session — เพื่อไม่ต้องอธิบายซ้ำ
> อัปเดตทุกครั้งที่มี decision ใหม่ / pattern ใหม่ / gotcha ใหม่

---

## 1. PROJECT OVERVIEW

**A.T.O.M.** = AI ผู้ช่วยที่ "โตไปด้วยกัน" กับ Boss (คุณเค้ก)
- 4 Personas: อะตอม (นักเลง 2499) / จาร์วิส (สุขุม) / ไฟรเดย์ (เนี๊ยบ) / อัลตรอน (ดุดัน)
- แต่ละ persona = AI แยกกัน (Prompt + Voice + Orb + Chat History)
- Shared Memory ร่วม (Phase 4.5+)

**Repo:** `assadawut170537cake-art/A.Tom` (branch: `main`)
**Owner:** คุณเค้ก — พูดไทย
**Workflow:** DeepSeek (architect) → Claude Code (coder) → Argon/Gemini (reviewer)

---

## 2. TECH STACK (LOCK — ห้ามเปลี่ยนโดยไม่ขอ)

- **Runtime:** Expo + React Native + TypeScript (strict) · **dev build** (ไม่ใช่ Expo Go — มี native code Kotlin ได้, Boss อนุมัติ 2026-10-18 · ADR-015)
- **State:** Zustand
- **Style:** NativeWind + Reanimated
- **Orb 3D:** WebView
- **Storage:** expo-secure-store (secrets) + AsyncStorage (data)
- **Voice:** expo-speech + expo-audio + expo-network
- **Navigation:** @react-navigation/native-stack (ไม่ใช่ Expo Router)
- **Icons:** lucide-react-native
- **AI:** Gemini + OpenRouter (Jev = optional, default off)

---

## 3. ARCHITECTURE — Core vs Module

### Folder Structure

    src/
    ├── core/           ← framework (ไม่มี feature logic)
    │   ├── crypto/     ← sigv4, hashing
    │   ├── http/       ← errors, request, redaction
    │   ├── storage/    ← ProviderSettings, ChatHistoryStorage, jsonStorage
    │   ├── types/      ← shared primitives (Persona, Message, AIProviderId, TTS/STT ids) + guards
    │   ├── memory/     ← MemoryStore, LocalMemoryAdapter, RemoteMemoryAdapter (Mark 55), SyncQueue, MemorySync
    │   ├── modules/    ← AtomModule, ModuleRegistry (runtime), ModuleManager (จำค่าเปิด/ปิด + กฎ dependency)
    │   ├── agent/      ← AgentHarness (loop + hooks) · MCPClientBridge · SkillEngine · DeviceControlBridge
    │   └── agents/     ← AgentRegistry (agent ที่สั่งจากแชทได้ + UI lazy) · components/AgentErrorBoundary
    │
    ├── modules/        ← loader.ts (stub) — ระดับแอป เพราะตาราง loader ต้อง import module จาก features/
    │   └── agents/     ← sample-agent.ts (agent "โน้ต") · noteStore · NoteAgentScreen
    ├── dev/            ← เครื่องมือทดสอบตอนพัฒนา (memoryDevTools, moduleDevTools — ติดตั้งเฉพาะ __DEV__)
    ├── boot.ts         ← ลำดับเปิดแอป: register providers → moduleManager.start() → นับ memory facts
    │
    └── features/       ← implementation (เปิด/ปิดได้)
        ├── ai/         ← providers, orchestrator, prompts
        ├── voice/      ← 17 providers (9 TTS + 8 STT), orchestrator
        ├── router/     ← IntentRouter, classifiers, handlers
        ├── jarvis/     ← MainScreen, conversation service
        ├── marketplace/← ตั้งค่า › Marketplace: MCP servers · Plugins · Skills · ควบคุมอุปกรณ์ (ค้นหา/กรอง/เปิดปิด/ติดตั้ง)
        ├── agents/     ← AgentScreen (route `Agent`) · AgentPanel (inline บนหน้าหลัก) · AgentHost · useAgentPanelStore
        ├── memory/     ← Memory tab: MemoryScreen + FactEditor (ดู/เพิ่ม/แก้/ลบ fact ใน Shared Memory)
        └── settings/   ← screens (Hub, AI, Modules, Sync, Voice, Persona Voice), components

### Dependency Direction
- ✅ `features/` → `core/` (ถูก)
- ❌ `core/` → `features/` (ผิดทั้งหมด รวมถึง `import type` — `architecture.test.ts` ตรวจให้)
- type ที่หลาย feature ใช้ร่วม → `core/types/`; type module เดิมของ feature re-export ไว้ (import จากที่เดิมได้)

### Patterns
1. Registry Pattern (ProviderRegistry, VoiceRegistry, ModuleRegistry)
2. Orchestrator Pattern (fallback chain + sticky `lastGood`)
3. Dependency Injection (ส่ง store/handler ผ่าน constructor)
4. Abstract Base Classes (BaseAIProvider, BaseCloudTTS, BaseCloudSTT)

---

## 4. LOCK DECISIONS (Phase 3 — ห้ามแก้)

1. LLM: Gemini + OpenRouter
2. Jev: default ปิด, fallback Gemini, ใช้ classifier เท่านั้น
3. Voice: 17 providers (TTS 9 + STT 8), Expo Speech = ตัวสุดท้าย (Boss เพิ่ม Gemini TTS 2026-10-15)
4. Router: 4 intents — `chat` / `pc_command` / `switch_assistant` / `agent` (Boss เพิ่ม `agent` 2026-10-16 · Jev/LLM ยังตอบได้แค่ 3 ตัวแรก)
5. Auto-Switch: Priority + Fallback + sticky lastGood
6. Storage: SecureStore (secrets) + AsyncStorage (data)
7. Settings: 3 หน้า (Hub + AI + Voice) + Persona Voice Map
8. Chat History: แยกต่อ persona (key: `atom.history.v1.<1-4>`)
9. Voice per Persona: Boss กำหนดเอง
10. Shared Memory: Phase 4.5 (scaffold แล้ว)
---

## 5. CONVENTIONS

### ภาษา
- Comment / JSDoc / Error message: **ไทยเป็นหลัก** (technical term อังกฤษได้)
- Variable / Function: camelCase (อังกฤษ)
- Type / Interface: PascalCase
- Constants: SCREAMING_SNAKE_CASE
- ไฟล์: PascalCase (class/component), camelCase (util)

### Comment
- อธิบาย "ทำไม" ไม่ใช่ "ทำอะไร"
- Workaround / provider quirk → ใส่ comment
- Cast → ใส่ comment เหตุผล
- TODO: `TODO(phase-4.5): ...`

### Error Message (แสดง user)
- **ภาษาไทยเสมอ** + actionable
- ตัวอย่าง: `"API Key ของ Gemini ไม่ถูกต้อง — ตรวจสอบได้ที่ ตั้งค่า › AI"`

### Testing
- Jest + @testing-library/react-native
- Mock ภายนอกเสมอ (fetch, SecureStore, AsyncStorage, expo-speech, expo-audio)
- Coverage target: 70%+
- ใช้ `nth(arr, i)` แทน `arr[i]`

---

## 6. TYPESCRIPT RULES

**Flags ที่เปิด (ห้ามปิด):**
`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`

**ห้าม:**
- `any` (โปรเจกต์นี้ any = 0)
- `@ts-ignore` / `@ts-expect-error` (ถ้าจำเป็น → comment เหตุผล)
- Non-null assertion `!` แบบไม่ระวัง

**Cast:**
- เฉพาะ trust boundary + comment
- ปัจจุบันมี 3 ตัว (keysOf, requestJson, storage settings id)

---

## 7. WORKFLOW

### Commit
- แยก sub-phase — อย่ารวบ
- Format: `<type>(<scope>): <subject>`
- types: feat / fix / refactor / test / docs / chore / types
- scope: phase3 / phase4 / voice / chat / router / core

### ก่อน Commit

    npm test
    npx tsc --noEmit
    npx expo lint
    npx expo export --platform android

### ห้ามทำโดยไม่บอก Boss
- เปลี่ยน tech stack
- เปลี่ยน lock decisions
- ลบไฟล์สำคัญ
- เพิ่ม dependency
- Reformat ทั้ง repo

---

## 8. GOTCHAS

### Race Conditions
- TTS: ใช้ `runId` guard
- Conversation: ใช้ `activeTurn` guard

### Storage
- Chat History: save หลังทุก message, key แยกต่อ persona
- ProviderSettings: field-level guard (เก็บดี ตัดเสีย)
- QuotaExceededError: writeChain ต้องไม่ค้าง

### Security
- API Key: SecureStore เท่านั้น
- Error Message: ผ่าน `redactSecrets()` ก่อน save
- Pattern: `sk-...`, `AIza...`, `AKIA...` (AKIA + 16 ตัว)
- Memory fact → prompt: ผ่าน `toPromptLine()` (บีบทุกแบบของการขึ้นบรรทัดใหม่ให้เหลือบรรทัดเดียว)

### Keyboard (หน้าหลัก)
- ทุกอย่างบน MainScreen เป็น absolute → ไม่ใช้ KeyboardAvoidingView; ใช้ `useKeyboardOverlap()` (measureInWindow เทียบ keyboard screenY) ยกเฉพาะช่องพิมพ์ + รายการแชท
- ไม่แก้ค่า `LAYOUT` ที่ lock — ตำแหน่งช่องพิมพ์คำนวณใน MainScreen

### Shared Memory (4.5.1)
- **Memory facts ถูกแนบใน system prompt แล้วตั้งแต่ boot** — แอปใช้ `getAppRouter()` (features/router/appRouter.ts) ซึ่งส่ง `localMemory` เข้า ChatHandler
- ห้ามสร้าง `new IntentRouter()` เปล่า ๆ ในโค้ดแอป (จะไม่มี memory) — ใช้ `getAppRouter()`; test สร้างเปล่าได้
- memory อ่านไม่ได้ → ChatHandler log แล้วตอบโดยไม่มี facts · `bootApp()` ไม่ reject (module/memory ล้มแค่ log)
- ทดสอบด้วยมือ: แท็บ Memory (4.5.2) หรือ dev menu "A.T.O.M.: เพิ่ม fact ทดสอบ" / DevTools console `atomDev.seed()`
- Memory UI: key ตาม `MEMORY_KEY_PATTERN` · value ≤ `MAX_FACT_LENGTH` (200, export จาก ChatHandler) · key ซ้ำในขอบเขตเดียวกัน = ปฏิเสธ (ไม่ทับเงียบ ๆ)
- ไม่มี swipe-to-delete เพราะต้องเพิ่ม react-native-gesture-handler (ต้องขอ Boss) → ใช้ long-press

### Modules (4.5.3)
- เปิด/ปิด module ในโค้ดแอป → ใช้ `moduleManager.enable/disable()` (จำค่าใน AsyncStorage `atom.modules.v1.enabled`) ไม่ใช่ `moduleRegistry.enable/disable()` ตรง ๆ (ไม่จำ)
- ลงทะเบียน module → `moduleManager.register()` หรือ `loadModule()` เพื่อให้ค่าที่บอสบันทึกไว้มีผล · boot เรียก `moduleManager.start()` (ใช้ค่าที่บันทึก → `initAll()`)
- ปิดตัวที่ module อื่นต้องใช้ → UI ถามก่อนแล้ว**ปิดตามทั้งหมด** · เปิดตัวที่ dependency ปิดอยู่ → **เปิด dependency ให้อัตโนมัติ**
- `init()` เป็น sync หรือ async ก็ได้ — `pending` ถูกเคลียร์หลัง promise settle เสมอ (แก้ข้อ 16 แล้ว · test ใน modules.test.ts)
- ทดสอบด้วยมือ: dev menu "A.T.O.M.: เพิ่ม module ทดสอบ" / `atomDev.addTestModules()` (module ปลอม 3 ตัว: ฐาน, ตัวที่พึ่งมัน, ตัวที่ init ล้มรอบแรก)

### Agent Harness
- `core/agent/AgentHarness.ts` รับ LLM ผ่าน `AgentLLM` (DI) เพราะ core import features ไม่ได้ — แอปใช้ `createAppAgent()` (features/ai/agent.ts = aiOrchestrator + moduleRegistry)
- โปรโตคอล LLM: JSON `{"tool":"<id>",...}` หรือ `{"final":"..."}` · ไม่ใช่ JSON = คำตอบสุดท้าย
- Max steps default 5 (`DEFAULT_MAX_STEPS`) · tool ล้ม/ไม่มี/ปิด → ส่งผลล้มกลับให้ LLM (ไม่ throw) · LLM ล้ม → `onError` แล้ว throw
- ผล tool ผ่าน `redactSecrets()` · hook ที่ throw แค่ log
- tool มาจาก ModuleRegistry ก่อน แล้วค่อย `providers` (SkillEngine → MCPClientBridge → DeviceControlBridge) · id ซ้ำ = ตัวแรกชนะ
- `memory` → แนบ facts (global + persona) ผ่าน `toPromptLine()` (ย้ายไป `core/memory/promptLine.ts`, ChatHandler re-export)
- **MCP:** Streamable HTTP JSON-RPC ผ่าน fetch (ไม่มี dep ใหม่) · รายการ server = AsyncStorage `atom.mcp.v1.servers` · token = SecureStore `mcp.<id>` · server ใหม่**ปิดไว้ก่อน** · tool id `mcp.<server>.<tool>` · https เท่านั้น (ยกเว้น localhost)
- **Skills:** = คู่มือขั้นตอน (ไม่รันโค้ด) เก็บ `atom.skills.v1` · ทักษะที่ AI สร้างเอง (`learnFrom`) **ปิดไว้รอบอสอนุมัติ** เพราะเนื้อหาเข้า prompt
- **Device:** ปิดเป็นค่าเริ่มต้น (`atom.device.v1.enabled`) · driver เริ่มต้นใช้แค่ `Linking` → volume / brightness / clipboard = "ยังไม่รองรับ" จนกว่าจะเพิ่ม expo-brightness / expo-clipboard ฯลฯ (ต้องขอ Boss) · WiFi = เปิดหน้าตั้งค่า (OS ไม่ให้แอปสลับเอง) · URL scheme อันตราย (tel/sms/javascript/file/…) ถูกบล็อก
- ยังไม่ได้ต่อเข้า conversation/IntentRouter — เรียกผ่าน `createAppAgent()` เมื่อพร้อม

### Personas ข้ามอุปกรณ์ + ควบคุมเครื่องเต็มรูปแบบ — ADR-015
- อะตอม = agent ประจำแอปนี้ ↔ Mark 55 บน PC (ตัวเดียวกัน คุยกันตลอด) · ไฟรเดย์ = แอป Gemini / **Gemini Spark** (โหมด agent ในแอป Gemini) ↔ Gemini Enterprise / Antigravity · จาร์วิส = เข้าประชุม + สายเข้า = สั่งงาน ↔ **Hermes** (ดูแล PC) · อัลตรอน = เบื้องหลัง (Foreground Service) ↔ โปรแกรมไหนก็ได้ที่ต่อ API · ตารางเต็มใน `docs/DECISIONS.md` ADR-015
- Boss ต้องการ **ควบคุมมือถือด้วยเสียงได้ 100%** ไม่ใช่แค่เพิ่ม/ลดเสียง → ระดับ A native module → ระดับ B AccessibilityService (ทุกแอป) → ระดับ C Shizuku/root (ทางเลือก)
- แอป Gemini ไม่มี API ให้แอปอื่นสั่งแล้วรับผลกลับ → สั่งได้ผ่าน AccessibilityService เท่านั้น · อย่าสัญญาว่าสั่ง Gemini Spark ตรง ๆ ได้
- งานเบื้องหลังบน Android = Foreground Service (ต้องมีแจ้งเตือนค้าง) · โค้ดของอัลตรอนรันใน Docker sandbox บน PC เท่านั้น แล้วรอบอส "ปลด" / "ทำลาย"
- คำสั่งอันตรายผ่าน AccessibilityService (ซื้อ/โอน/ลบ/ส่งข้อความ) ต้องถามยืนยันก่อนเสมอ

### Agents (intent `agent`) — ADR-013
- ลำดับ router: Rule → **AgentClassifier** → Jev → LLM → chat · ไม่มี agent ลงทะเบียน = ทำงานเหมือนเดิม
- `core/agents/` ≠ `core/agent/` (AgentHarness) — agents = ผู้ช่วยที่สั่งจากแชทด้วย regex + มี UI · harness = loop LLM เรียก tool
- Jev / LLM ตอบได้แค่ `MODEL_INTENTS` (3 ตัวเดิม) — model บอกไม่ได้ว่า agent ตัวไหน → อย่าเพิ่ม `agent` ใน CRITERIA / classifier prompt
- pattern ของ agent ต้องแคบ (ขึ้นต้นประโยค + คำเชื่อมเช่น "ว่า"/":") เพราะมาก่อน LLM · Rule มาก่อน → คำสั่งที่มี "เปิด/ปิด…คอม/เครื่อง" โดน `pc_command` แย่ง
- agent ล้ม → AgentHandler ตอบข้อความไทย (ไม่ throw) · UI ครอบ `AgentErrorBoundary` ผ่าน `AgentHost` · โหลด UI ล้มไม่ cache (ลองใหม่ได้)
- ลงทะเบียน agent ตอน boot (`registerSampleAgents()` ใน `bootApp()`) · test ใช้ `new AgentRegistry()` แยก

### Sync กับ Mark 55 (4.5.4.2–4.5.4.3) — สเปกเต็ม `docs/SYNC_PROTOCOL.md`
- `memorySync` (core/memory/MemorySync.ts) = ตัวเดียวทั้งแอป: Server URL · pair/unpair · testConnection · เป็นเจ้าของ `SyncQueue` · boot เรียก `start()`
- ไม่จับคู่ = ไม่ฟัง memory ไม่มี timer → แอปเครื่องเดียวเหมือนเดิม · จับคู่ครั้งแรก → `enqueueAll()` ส่ง fact ที่มีอยู่ขึ้นไปด้วย
- token: SecureStore `mark55.auth.token` (เท่านั้น) · AsyncStorage `mark55.sync.{serverUrl,device,queue,lastSyncAt,conflicts,autoSync}`
- LocalMemoryAdapter `subscribe()` → คิว · ของจาก server เขียนด้วย `applyRemote()` (ไม่แจ้ง listener — กันส่งกลับซ้ำ, คง `updatedAt` ของ server)
- conflict: ตัวตน = target+key · แก้ชนะลบ · ไม่งั้น `updatedAt` ใหม่กว่าชนะ (เท่ากัน = local) · server ชนะ → จด conflict log (เก็บ 50)
- `lastSyncAt` = เวลา server **ตอน pull** และส่งค่านี้ไปกับ push (server ใช้แยก conflict จริง) — ห้ามเปลี่ยนเป็นเวลาตอน push (ของเครื่องอื่นจะหาย) · server ปฏิเสธแบบไม่ส่งฉบับมา → `lastSyncAt = 0`
- ⚠️ Mark 55 ต้องใช้ "แก้ชนะลบ" เฉพาะฉบับที่ `syncedAt > lastSyncAt` ไม่งั้นการลบไม่ไปถึงเครื่องอื่น ([SYNC_PROTOCOL §12](docs/SYNC_PROTOCOL.md))
- conflict log: `clearConflicts()` / `setAutoSync()` / `reset()` รอ `restore()` ก่อน · โหลดมาเกิน 50 ตัดทิ้ง
- ทดสอบกติกาด้วย `FakeMark55Server` (src/test-utils/fakeMark55.ts) + `syncConflict.test.ts` — server จริงเปลี่ยนกติกา → แก้ตัวจำลองตาม
- retry อยู่ใน SyncQueue เท่านั้น (backoff 5s→5 นาที, 401 ไม่ retry) · RemoteMemoryAdapter ไม่ retry, timeout 10s
- Server URL: http ได้เฉพาะ LAN/localhost/.local/Tailscale (100.64/10) · ที่อยู่สาธารณะต้อง https (`normalizeServerUrl`)
- ⚠️ ชื่อ field ของ API อิง wire format ใน spec (ไม่มีโค้ด server ใน repo) — ถ้า Mark 55 ใช้ชื่ออื่น แก้ที่ RemoteMemoryAdapter ที่เดียว
- release build Android เปิด http ไว้ด้วย config plugin `plugins/withCleartextTraffic.js` (ใช้ expo/config-plugins ที่มากับ expo · ไม่ต้องเพิ่ม expo-build-properties) — การจำกัด http ให้แค่ LAN ทำในโค้ด (`normalizeServerUrl`)
- Build APK: `npx eas-cli build -p android --profile preview` (eas.json) หรือ local `npx expo prebuild -p android` แล้ว `cd android && ./gradlew assembleRelease` · package `com.atom.assistant` (เปลี่ยนแล้วแอปเดิมอัปเดตทับไม่ได้) · local build เซ็นด้วย debug keystore ของ template
- `plugins/withAndroidProjectName.js`: Gradle 9 ห้ามชื่อโปรเจกต์ขึ้นต้น/ลงท้ายด้วย "." ("A.T.O.M.") → ตั้ง rootProject.name = slug · ห้ามลบ ไม่งั้น build Android ล้ม

### Supermemory (ส่ง fact ขึ้น space ร่วมของทีม)
- `superMemorySync` (core/memory/SuperMemorySync.ts) ฟัง `localMemory.subscribe()` → `POST /v3/documents` · containerTag `project_atom_memory_base_4folders_atom_core` (ไม่ใช่ `atom_core` เปล่า ๆ — คนละ space)
- key: SecureKeyStore `supermemory.apiKey` เท่านั้น (ใส่ที่ ตั้งค่า › Sync) · ไม่มี key = ไม่ส่ง · ห้ามใช้ `EXPO_PUBLIC_*` (ถูกฝังใน APK)
- fail-open: ไม่ throw ไม่ retry ส่งไม่ผ่านก็ทิ้ง · ไม่ส่งการลบ (ต้องใช้ document id ที่เครื่องไม่ได้จด) · `applyRemote` ไม่แจ้ง listener → ของจาก Mark 55 ไม่ถูกส่งซ้ำ

### Mark 55 Bus — `pc-bridge` (4.5.5.3) · SQL `mark55/sql/002_mobile_rpc.sql`
- คนละช่องทางกับ Sync (Fastify, memory facts): Bus = สั่งงานให้ Mark 55 รัน ผ่านตาราง `memory_tasks` บน Supabase
- แอปเรียกได้แค่ RPC `mobile_submit_task` / `mobile_get_task` ด้วย anon/publishable key + **token เครื่อง** (`atm_…`, Supabase เก็บแค่ sha256) · ตารางทั้งหมดปิดสำหรับ anon — **ห้ามเปิด policy ให้ anon** (anon key ดึงจาก APK ได้)
- ออก token: `select public.mobile_register_device('<device>', '<label>')` ใน SQL Editor (service_role เท่านั้น) · ยกเลิก: `update mobile_devices set revoked = true`
- เพิ่มคำสั่ง: handler ใน `mark55/handlers.py` → INSERT `mobile_instructions` → แถวใน `PC_COMMANDS` (features/pc-bridge/commands.ts)
- module ตอบข้อความไทยเองทุกกรณี (ไม่ throw) — ถ้า throw ProviderError แชทจะแนะนำ "ตั้งค่า › AI" ซึ่งผิดที่ · รอผล 8s แล้วตอบว่า "ส่งแล้ว" (งานรอในคิวจนกว่า Mark 55 จะเปิด)
- ⚠️ "เช็กเครื่อง" เฉย ๆ ไม่ผ่าน RuleClassifier (ต้องมี เปิด/ปิด/สั่ง + คอม/เครื่อง) → ขึ้นกับ LLM classifier · พิมพ์ "สั่งคอมเช็กสถานะ" ชัวร์กว่า · "ปิดคอม" = ยังไม่รองรับ (ไม่มี handler)
- Jest ไม่แปลง `import()` แบบ dynamic → test loader ด้วย factory ของตัวเอง (`MODULE_LOADERS` จริงทดสอบได้แค่ว่ามี key)

### คุยด้วยเสียงแบบไลฟ์ (Live Voice)
- `features/voice/live/LiveVoiceSession.ts` = state machine ล้วน (DI: recorder / ensureMic / transcribe / respond / stopSpeech / timers) · ต่อเข้าแอปที่ `features/jarvis/hooks/useLiveVoice.ts` (expo-audio `useAudioRecorder` + `voiceOrchestrator.listen()` + `sendMessage()`)
- เข้าโหมด: **กดค้างที่ Orb** หรือ **ปุ่มไมค์ในช่องพิมพ์** · ออก: แตะ Orb / ปุ่มไมค์อีกครั้ง / สลับแท็บ · ระหว่างไลฟ์ช่องพิมพ์ส่งไม่ได้ (กันสองรอบแย่งกันพูด)
- VAD จาก metering (dBFS) poll ทุก 100ms: ดัง ≥ `SPEECH_THRESHOLD_DB` (-40) = พูด · เงียบ `SILENCE_END_MS` (1.2s) = จบ · สั้นกว่า `MIN_SPEECH_MS` (0.4s) = เสียงรบกวน · ยาวสุด `MAX_UTTERANCE_MS` (30s) · ไม่มีใครพูด `IDLE_TIMEOUT_MS` (30s) = ออกเอง · เงียบนำหน้า `PRE_SPEECH_RESET_MS` (8s) = ทิ้งไฟล์อัดใหม่
- ⚠️ ค่า dBFS ต่างกันตามเครื่อง: Android = peak (`maxAmplitude`), iOS = average power → ถ้าเครื่องจริงตัดประโยคเร็ว/ไม่ยอมจบ ปรับ `SPEECH_THRESHOLD_DB` ที่เดียว
- ระหว่างผู้ช่วยพูด **ไม่อัดเสียง** (กันได้ยินตัวเอง) — ยังไม่มี barge-in · recorder หยุดแล้วคืน `allowsRecording: false` ทุกครั้ง (iOS playAndRecord ทำเสียง TTS เบา)
- หยุดระหว่างรอ AI → `sendMessage({ onSpeaking })` คืน false = ไม่พูดคำตอบ · งาน async รอบเก่าทิ้งด้วย `runId` guard
- ถอดเสียงว่าง → ฟังใหม่เงียบ ๆ · STT ไม่ได้ตั้งค่า (`missing_key`/`unsupported`) → ออกจากโหมด + ข้อความไทยชี้ ตั้งค่า › เสียง · ไมค์ไม่ได้สิทธิ์ → ข้อความจาก `ensureMicPermission()`
- `VoiceOrchestrator` รวม error ของ chain: ล้มเพราะ "ยังไม่ตั้งค่า" ทั้งหมด → `missing_key` (เดิม `commonKind` ได้ `server` เพราะ Expo STT = unsupported ปนกับ missing_key)
- test: `liveVoice.test.ts` (fake timers + fake recorder) · mock `useAudioRecorder` อยู่ใน `jest.setup.js` (metering -160 = เงียบ)

### เลือกโมเดล AI (ตั้งค่า › AI)
- `ModelPicker` (settings/components) เรียก `provider.listModels?.()` — ดึงสดเท่านั้น ล้ม = throw ProviderError (ไม่ fallback รายการใน config) · `getModels()` เดิมยังอยู่ใน interface (รายการ config ได้)
- parser รายชื่อโมเดลอยู่ `features/ai/core/modelLists.ts` (type guard, ไม่ cast) · Gemini ส่ง key ทาง header `x-goog-api-key` ไม่ใช่ `?key=`
- cache = `modelListCache` (หน่วยความจำ, ต่อ provider, ทั้ง session) · บันทึก/ลบ key → ProviderCard ล้าง cache + remount picker (`key={keyVersion}`)
- "พิมพ์ชื่อเอง" ต้องมีเสมอ (Boss ขอ) — ค่าที่บันทึกยังเป็น string เดียวใน `ProviderSettings.models[id]`

### Network
- `isOffline()` fail-open
- Timeout: AbortController + ProviderError

### Jev
- Default ปิด, threshold `>= 0.7`
---

## 9. PARKING LOT (ก่อน Phase 4.5)

### ต้องทำก่อน
1. ✅ ย้าย shared types (`Persona`, `AIProviderId`) → `core/types/` — รวม `Message` + TTS/STT ids, core ไม่ import features แล้ว
2. ✅ Prompt injection guard (ADR-011) — ขั้นแรก: `toPromptLine()` บีบ fact เป็นบรรทัดเดียว (กันปลอมบรรทัด "System:")
   **A1 (ADR-014):** `toPromptLine()` redact ทั้งบรรทัดเป็น `[REDACTED BY GUARD]` ถ้าเจอ "ignore previous/all instructions" · `system:` (มี word boundary — `filesystem:` ผ่าน) · `<|...|>`
   ⚠️ เป็น blacklist แคบ ๆ (อังกฤษเป็นหลัก) ไม่ใช่การกันครบ — ทบทวนอีกครั้งก่อนเปิดให้ module เขียน memory ได้
3. ✅ ย้าย `loader.ts` → app-level (`src/modules/loader.ts`)

### ระหว่าง Phase 4.5
4. ✅ Remote Memory Adapter (4.5.4.2a — Mark 55)
5. ✅ SyncQueue.flush() + persist (4.5.4.2c) + หน้า ตั้งค่า › Sync (4.5.4.2b)
6. ✅ Module `pc-bridge` จริง (4.5.5.3 — Memory Bus ผ่าน Supabase)
7. ✅ UI Memory (4.5.2) — แท็บ Memory: list + filter + เพิ่ม/แก้ (แตะ) / ลบ (กดค้าง หรือปุ่มในฟอร์ม)
8. ✅ UI Module Manager (4.5.3) — ตั้งค่า › Modules: สวิตช์เปิด/ปิด (จำค่า) + รายละเอียด + เริ่มใหม่ + กฎ dependency

### หลัง Phase 4.5
9. ✅ Prettier config (A5) — `.prettierrc` + `.prettierignore` + scripts `format` / `format:check`
   ✅ `prettier` อยู่ใน devDependencies แล้ว (Boss อนุมัติ 2026-10-18) · format เฉพาะไฟล์ .ts/.tsx/.js ที่งานนี้แตะ — ไฟล์อื่นยังไม่ได้ format (ห้าม `npm run format` ทั้ง repo โดยไม่บอก Boss)
10. Module อื่นๆ — คู่มือสร้าง module: `src/modules/README.md` (B1)

### Nice to Have
11. ✅ `SECRET_PATTERN` เพิ่ม `|AKIA[0-9A-Z]{16}`
12. ✅ `AGENTS.md` อัปเดตให้ตรง ADR-009

### Findings จาก Boss test (emulator) — แก้แล้วในงาน Parking Lot Cleanup (ต้องทดสอบบนเครื่องจริง)
13. ✅ **Voice Persona Map default** (A2) — `DEFAULT_PERSONA_VOICE_MAP` (นิยามใน `core/storage/ProviderSettings.ts`, re-export ที่ `voice.config.ts`) · `resolveVoiceFor()` = shared voice → ค่าที่ตั้ง → default · default ใช้ Expo Speech แยกด้วย pitch/speed เท่านั้น (ไม่ใส่ voiceId เพราะ identifier ต่างกันตามเครื่อง)
    เดิม: — ถ้ายังไม่ได้ตั้ง Persona Voice Map ทุก persona พูดด้วยเสียง Expo Speech ค่าเริ่มต้นเดียวกัน
    (`resolveVoiceFor()` คืน `undefined` → ตกไปที่ Expo Speech ไม่ส่ง voice/speed/pitch) → ควรมีค่าเริ่มต้นต่อ persona
14. ✅ **Orb แยก shape/animation** (A3) — `ORB_VARIANTS` ใน `orbHtml.ts` (facet / spin / sharp / gloss / stutter / pulse) ส่งเข้า shader เป็น uniform · `setOrbPersona(p)` สลับ variant · ⚠️ GLSL ใหม่ยังไม่ได้ลองบน GPU จริง (ผ่านบน WebGL SwiftShader แล้ว)
    facet เดิมปัดมุมเป็นขั้น → รัศมีกระโดด เกิดรอยแฉกในแสงเรือง (อะตอม/อัลตรอน) → แก้เป็นรูป 9 เหลี่ยมที่ต่อเนื่อง
    เดิม: — ตอนนี้ `setOrbPersona()` เปลี่ยนแค่สี shader/animation เหมือนกันทั้ง 4 ตัว → ต้องการรูปทรง/การเคลื่อนไหวเฉพาะ persona
15. ✅ **สี Atom vs Ultron ต่างชัด** (A4) — Atom `#E67E22` · Ultron `#C0392B` (contrast บนดำ ≥ 3:1 มี test) · Boss อนุมัติเปลี่ยน lock Phase 2 แล้ว
    เดิม: — อะตอม `#d35400` (ส้มเข้ม) กับอัลตรอน `#ff0033` (แดง) ดูใกล้กันบนจอจริง → ต้องปรับให้แยกออกชัด
    (ค่า `PERSONAS` ถูก lock ไว้ตั้งแต่ Phase 2 — เปลี่ยนต้องให้ Boss อนุมัติ)

### Findings ระหว่างทำ 4.5.3
16. ✅ **ModuleRegistry: `pending` ค้างเมื่อ `init()` แบบ sync throw** (module ไม่มี dependency) — IIFE จบก่อน assign
    `entry.pending` → finally เคลียร์ก่อน แล้ว promise ที่ reject ถูก assign ทับ → "เริ่มใหม่" / ปิด-เปิดใหม่ init ไม่ได้อีก
    (sync ที่สำเร็จไม่โดน เพราะ `await undefined` ยัง yield) · แก้: assign `pending` ก่อน แล้วเคลียร์หลัง `await run` (Boss อนุมัติ)

---

## 10. QUICK REFERENCE

### คำสั่ง

    npm test
    npm run test:coverage
    npx tsc --noEmit
    npx expo lint
    npx expo start

### Path สำคัญ
- Entry: `index.ts` → `App.tsx` → `RootNavigator.tsx`
- Main: `src/features/jarvis/screens/MainScreen.tsx`
- AI Orchestrator: `src/features/ai/core/Orchestrator.ts`
- Voice Orchestrator: `src/features/voice/core/VoiceOrchestrator.ts` · Live voice: `src/features/voice/live/LiveVoiceSession.ts` · `src/features/jarvis/hooks/useLiveVoice.ts`
- Intent Router: `src/features/router/core/IntentRouter.ts`
- Memory: `src/core/memory/LocalMemoryAdapter.ts`
- Module: `src/core/modules/ModuleRegistry.ts` · `ModuleManager.ts` · loader: `src/modules/loader.ts`
- Modules UI: `src/features/settings/screens/ModulesScreen.tsx`
- เลือกโมเดล AI: `src/features/settings/components/ModelPicker.tsx` · parser `src/features/ai/core/modelLists.ts`
- Mark 55 Bus: `src/features/pc-bridge/` · UI `src/features/settings/screens/PcBridgeScreen.tsx` · SQL `mark55/sql/002_mobile_rpc.sql`
- Supermemory: `src/core/memory/SuperMemorySync.ts`
- Sync: `src/core/memory/MemorySync.ts` · `SyncQueue.ts` · `RemoteMemoryAdapter.ts` · UI `src/features/settings/screens/SyncScreen.tsx`
- Agents (intent): `src/core/agents/AgentRegistry.ts` · `src/features/router/classifiers/AgentClassifier.ts` · `handlers/AgentHandler.ts` · `src/features/agents/` · sample `src/modules/agents/sample-agent.ts`
- Agent: `src/core/agent/` · app wiring `src/features/ai/agent.ts` · Marketplace: `src/features/marketplace/screens/PluginMarketplaceScreen.tsx`
- Shared types: `src/core/types/`
- Boot: `src/boot.ts` · App router (มี memory): `src/features/router/appRouter.ts`

### Fallback
- AI: Priority → lastGood → notice user
- Voice: Priority → Expo Speech

---

## 11. WHEN TO ASK

**ถามก่อน:**
- เปลี่ยน arch
- เพิ่ม dep
- เปลี่ยน lock
- ลบไฟล์
- Reformat ใหญ่

**ทำได้เลย:**
- เขียน test
- Refactor ใน module
- แก้ bug ชัดเจน
- เพิ่ม type
- เพิ่ม doc

---

## 12. REFERENCE

- ADR: `docs/DECISIONS.md`
- Sync protocol: `docs/SYNC_PROTOCOL.md`
- Architecture: `docs/ARCHITECTURE.md`
- Changelog: `CHANGELOG.md`

---

**Last updated:** 2026-10-18 (Parking Lot Cleanup: A1 guard v2 · A2 default voice · A3 orb variants · A4 สี · A5 prettier config · B1 module guide · 4.5.4.3: ตรวจ conflict/LWW/tombstone + SYNC_PROTOCOL.md · 4.5.4.2: Mark 55 sync — RemoteMemoryAdapter · SyncQueue · Sync screen · MCP · Skills · Device · Marketplace · Agent Harness · fix ModuleRegistry stale pending · 4.5.3: Module Manager UI · 4.5.2: Memory UI · 4.5.1: localMemory → ChatHandler + boot)
**Version:** 1.0
