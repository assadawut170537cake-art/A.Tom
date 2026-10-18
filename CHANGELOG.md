# Changelog

บันทึกการเปลี่ยนแปลงทั้งหมดของ A.T.O.M. เรียงจากใหม่ไปเก่า

รูปแบบอิง [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — หัวข้อใช้ชื่อ Phase แทนเลขเวอร์ชัน
(แอปยังไม่ได้ออก release; `package.json` ยังเป็น `1.0.0`) แต่ละหัวข้อแบ่งเป็น
**Added** · **Changed** · **Fixed** · **Removed** · **Security**

ภาพรวมสถาปัตยกรรม → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · เหตุผลของการตัดสินใจ → [docs/DECISIONS.md](docs/DECISIONS.md)

---

## [Unreleased]

### Parking Lot Cleanup (Phase 4.5 pre-5)
- **Security (A1, [ADR-014](docs/DECISIONS.md#adr-014--prompt-injection-guard-v2)):** `toPromptLine()` redact ทั้งบรรทัดเป็น `[REDACTED BY GUARD]` เมื่อเจอ "ignore previous/all instructions", `system:` (word boundary), `<|...|>` — มีผลกับ memory fact · skill ที่ AI สร้าง · ผลจาก MCP · tool result ที่ผ่านฟังก์ชันนี้
- **Voice (A2):** `DEFAULT_PERSONA_VOICE_MAP` — persona ที่ยังไม่ตั้งเสียงได้ pitch/speed ของตัวเอง (Expo Speech) แทนเสียงเดียวกันหมด · ค่าที่บอสตั้งชนะเสมอ
- **Orb (A3):** variant ต่อ persona (อะตอมเหลี่ยมหยาบหมุนช้า · จาร์วิสเนียน · ไฟรเดย์คมหมุนเร็ว · อัลตรอนกระตุกพัลส์แรง) ผ่าน `setOrbPersona()`
- **Theme (A4):** Atom `#d35400` → `#E67E22` · Ultron `#ff0033` → `#C0392B` (Boss อนุมัติ)
- **Tooling (A5):** `.prettierrc` · `.prettierignore` · scripts `format` / `format:check` · `prettier` เป็น devDependency (Boss อนุมัติ) · format เฉพาะไฟล์ที่งานนี้แตะ
- **Docs (B1):** `src/modules/README.md` — คู่มือสร้าง module + `demo-module` ตัวอย่าง (ไม่ได้อยู่ในโค้ดแอป)

### Added
- **Build แอป Android (APK ติดตั้งเองได้):** `eas.json` (profile `preview` = APK, `production` = AAB) · package `com.atom.assistant` · `plugins/withCleartextTraffic.js` ให้ release build ต่อ Sync server แบบ http ใน LAN ได้ (ใช้ expo/config-plugins ที่มากับ expo — ไม่มี dependency ใหม่)
- **ซิงก์ Memory เข้า Supermemory:** `core/memory/SuperMemorySync.ts` (`SuperMemorySyncService`) ฟัง `LocalMemoryAdapter.subscribe()` → fact ที่เพิ่ม/แก้ส่ง `POST https://api.supermemory.ai/v3/documents` (`containerTag: project_atom_memory_base_4folders_atom_core`, `dreaming: instant`) ทีละรายการตามลำดับ · fail-open (เน็ตหลุด / key ผิด / server ล่ม / timeout 10s แค่ log — save() และแชทไม่รอ) · ไม่ส่งการลบ และไม่ส่งของที่ดึงจาก Mark 55 · API key ใน SecureStore (`atom.secret.supermemory.apiKey`) ใส่ได้ที่ **ตั้งค่า › Sync › Supermemory** · boot เรียก `superMemorySync.start()` · `redactSecrets()` ปิด `sm_…`
- **คุยด้วยเสียงแบบไลฟ์ (Live Voice):** กดค้างที่ Orb หรือปุ่มไมค์ในช่องพิมพ์ → ฟัง → ตรวจจบประโยคจากระดับเสียง (VAD: เงียบ 1.2s, ตัดเสียงสั้นกว่า 0.4s, ยาวสุด 30s, ไม่มีใครพูด 30s ออกเอง) → ถอดเสียงด้วย STT chain เดิม → ข้อความขึ้นเป็นของบอสในแชท → ผู้ช่วยตอบ + พูด → ฟังต่ออัตโนมัติ จนกว่าจะแตะ Orb/ปุ่มไมค์ · สถานะไทย (กำลังฟัง… / กำลังถอดเสียง… / กำลังคิด… / กำลังพูด…) · ไม่อัดเสียงระหว่างผู้ช่วยพูด · ไม่มี STT / key → ออกจากโหมดพร้อมบอกให้ตั้งค่าที่ ตั้งค่า › เสียง · `voice/live/LiveVoiceSession.ts` (state machine, DI) + `jarvis/hooks/useLiveVoice.ts` (expo-audio recorder + metering) — ไม่มี dependency ใหม่
- **เลือกโมเดล AI จากรายชื่อจริง** (ตั้งค่า › AI): `ModelPicker` แทนตัวเลือกเดิม — กดแล้วโหลดรายชื่อโมเดลจาก API ของผู้ให้บริการทันที (ไม่ต้องกด "โหลดรายการ" ก่อน) · ช่องค้นหา · "โหลดรายชื่อใหม่" · สถานะกำลังโหลด / error ไทย · **"พิมพ์ชื่อเอง"** เมื่อโหลดไม่ได้หรือโมเดลไม่อยู่ในรายการ · ยังไม่บันทึก key → แสดงคำแนะนำ + รายการเริ่มต้น · cache รายชื่อในหน่วยความจำต่อ provider ตลอด session (ล้างเมื่อบันทึก/ลบ key) · `AIProvider.listModels?()` ดึงสดไม่ fallback: Gemini `GET /v1beta/models` (เฉพาะ `generateContent`, ตามหน้า ≤ 5), OpenRouter/OpenAI-compatible `GET {baseURL}/models`, Jev `GET /v1/models` · parser ใช้ type guard (`features/ai/core/modelLists.ts`) · ค่าที่บันทึก (`models[providerId]`) รูปแบบเดิม
- **4.5.5.3 สั่งงาน Mark 55 จากแชท (Memory Bus):** module `pc-bridge` (`features/pc-bridge/`) โหลดตอน boot → intent `pc_command` ส่งงานเข้า Supabase ผ่าน RPC `mobile_submit_task` แล้วรอผลด้วย `mobile_get_task` (fetch ตรง ไม่มี dependency ใหม่) · คำสั่งที่รองรับ: เช็กเครื่อง (`RUN_DIAGNOSTICS`) · บิลด์ (`EXECUTE_BUILD`) · หน้า **ตั้งค่า › Mark 55 Bus** (Project URL · anon/publishable key · token เครื่อง ใน SecureStore · ทดสอบการเชื่อมต่อ) · `mark55/sql/002_mobile_rpc.sql` (token เก็บเป็น hash, instruction allowlist, จำกัด 20 งาน/นาที/เครื่อง, เห็นเฉพาะงานของเครื่องตัวเอง)
- **Agent Screen Navigation:** intent ที่ 4 `agent` · `core/agents/` (`AgentRegistry` singleton: register / getAgent / list / run / lazy `getScreenComponent` · `AgentErrorBoundary` ข้อความไทย + ลองใหม่) · `AgentClassifier` (หลัง Rule ก่อน Jev) + `AgentHandler` · **Agent Panel** บนหน้าหลัก (ปิด / ขยายเต็มจอ) + หน้า `Agent` (`features/agents/`) · sample agent **"โน้ต"** ("จดบันทึกว่า …" / "ดูโน้ต", เก็บใน `atom.agents.v1.notes`) ลงทะเบียนตอน boot ([ADR-013](docs/DECISIONS.md#adr-013--agent-intent--agent-panel))
- **4.5.4.3 Sync docs + verification:** `docs/SYNC_PROTOCOL.md` (ภาพรวม · pairing · wire format · endpoint · รอบ flush · ตารางกติกา LWW + tombstone · conflict log · retry · storage · security · ข้อตกลงที่ server ต้องทำตาม · การทดสอบ) · ADR-012 เพิ่มเรื่อง cursor · `FakeMark55Server` + `syncConflict.test.ts` (2 เครื่องซิงก์ผ่าน server จำลอง, ตาราง LWW ครบ, conflict log 50 + ล้าง, clock skew)
- **4.5.4.2 Sync กับ Mark 55:** `RemoteMemoryAdapter` (pair / verify / pull / push / health ผ่าน `request()`, timeout 10s, ข้อความ error ไทย) · `SyncQueue` (คิว persist ใน AsyncStorage, pull → resolve conflict → push, conflict log, retry backoff, trigger: เปิดแอปกลับมา / เน็ตกลับมา / ปุ่ม / อัตโนมัติ 30s) · `MemorySync` (Server URL, จับคู่ด้วยรหัส 6 หลัก → token ใน SecureStore) · หน้า **ตั้งค่า › Sync** (สถานะ 🟢🟡🔴, ทดสอบการเชื่อมต่อ, Pair / ยกเลิก Pair, รอส่ง, ซิงก์ตอนนี้, ซิงก์อัตโนมัติ, ประวัติ Conflict) · `LocalMemoryAdapter.subscribe()` + `applyRemote()`
- **MCP / Skills / Device Control / Marketplace:** `core/agent/MCPClientBridge.ts` (MCP Streamable HTTP: initialize → tools/prompts/resources, tools/call, token ใน SecureStore) · `SkillEngine.ts` (ทักษะแนะนำ + ทักษะที่ AI สังเคราะห์จากงานที่สำเร็จ — ปิดไว้รออนุมัติ, วิเคราะห์ tool ที่ล้มซ้ำ) · `DeviceControlBridge.ts` (ปิดเป็นค่าเริ่มต้น, safety guards, driver แบบเสียบได้) · AgentHarness รับ `providers` + `memory` + `args` · หน้า **ตั้งค่า › Marketplace** (ค้นหา, กรอง, เปิด/ปิด, ติดตั้งทักษะ, เพิ่ม/ลบ MCP server, ดู tools) · `toPromptLine` ย้ายไป `core/memory/promptLine.ts`
- **Agent Harness** (`core/agent/`): execution loop คิด → เรียก tool (CommandModule ใน ModuleRegistry) → สังเกตผล → ตอบ · max steps guard (default 5) · hooks onStart / onStep / onToolCall / onComplete / onError · `features/ai/agent.ts` (`createAppAgent()`) ต่อกับ aiOrchestrator + moduleRegistry
- **4.5.3 Module Manager** (ตั้งค่า › Modules ระหว่าง AI Providers กับ Voice): รายการ module + สถานะ (ทำงานอยู่ / ยังไม่เริ่ม / เริ่มไม่สำเร็จ / ปิดอยู่) · สวิตช์เปิด/ปิด · แตะดูรายละเอียด (รหัส, ต้องใช้, ใช้โดย) + ปุ่มเปิด/ปิด + "เริ่มใหม่" · ปิดตัวที่ module อื่นต้องใช้ → ถามยืนยันแล้วปิดตามทั้งหมด · เปิดตัวที่ dependency ปิดอยู่ → เปิด dependency ให้อัตโนมัติ
- `core/modules/ModuleManager.ts`: จำค่าเปิด/ปิดใน AsyncStorage (`atom.modules.v1.enabled`) ใช้ตอน boot (`moduleManager.start()`) และกับ module ที่ลงทะเบียนทีหลัง · `ModuleRegistry.getStatus()` + `description` ของ module · `src/dev/moduleDevTools.ts`: เมนู dev "เพิ่ม module ทดสอบ" / `atomDev.addTestModules()`
- **4.5.2 Memory UI** (`features/memory`): แท็บ Memory แทน "เร็วๆ นี้" — รายการ fact (key · ค่า · ป้ายขอบเขต · ป้ายที่มา) + filter ทั้งหมด/Global/Persona · ปุ่ม + เพิ่ม · แตะเพื่อแก้ (ย้าย key/ขอบเขตได้) · กดค้างเพื่อลบ (ถามยืนยัน) · ตรวจ key ตาม `MEMORY_KEY_PATTERN` และค่าไม่เกิน 200 ตัว
- **4.5.1 Shared Memory ใช้งานจริง:** `getAppRouter()` ส่ง `localMemory` เข้า ChatHandler → facts แนบใน system prompt ทุกครั้งที่คุย · `src/boot.ts` (`bootApp()`): register providers → `moduleRegistry.initAll()` + นับ facts แบบ async ไม่บล็อก UI และไม่ crash · `src/dev/memoryDevTools.ts`: เมนู dev + `atomDev.seed()/list()/clear()` สำหรับทดสอบ
- **ลิงก์ "🔗 สร้าง API Key"** ใต้ช่อง API key ในหน้าตั้งค่า AI / Voice (`settings/constants/providerLinks.ts`) — Gemini, OpenRouter, OpenAI, ElevenLabs, Google Cloud, Azure, Polly
- **Gemini TTS** (`voice/tts/GeminiTTS.ts`): TTS ตัวที่ 9 ผ่าน `generateContent` (AUDIO) · 30 prebuilt voices · ใช้ key เดียวกับ Gemini LLM (ใส่ key แยกในการ์ด TTS ได้) · model ตั้งได้ (ค่าเริ่มต้น `gemini-3.8-flash-tts`) · PCM ดิบของรุ่น 2.5/3.1 ห่อเป็น WAV (`voice/core/wav.ts`)
- `src/core/types/`: `persona.ts`, `message.ts`, `aiProvider.ts`, `voiceProvider.ts` — shared primitives ย้ายมาจาก features · `architecture.test.ts` กัน core import จาก features
- **Chat UI จริง:** `ChatInput` (พิมพ์ได้หลายบรรทัด สูงสุด 4 บรรทัด, ปุ่มส่งสีตาม persona) ต่อเข้ากับ `sendMessage()` · ปุ่ม ⌨️ โฟกัสช่องพิมพ์ · แถบเตือน "ยังไม่ได้ตั้งค่า API key" แตะแล้วไปหน้า AI Providers
- **Phase 4 scaffold — Shared Memory** (`src/core/memory/`): `MemoryStore` interface, `LocalMemoryAdapter` (AsyncStorage `atom.memory.v1.<scope>.<key>`, fallback ในหน่วยความจำ), `RemoteMemoryAdapter` (stub), `SyncQueue` (skeleton offline-first)
- **Phase 4 scaffold — Module System** (`src/core/modules/`): `AtomModule`, `ModuleRegistry` (init ตาม dependency, dispose ย้อนลำดับ), `src/modules/loader.ts` (stub, ระดับแอป)
- Hook: `ChatHandler` รับ `memoryStore` แล้วแนบ facts ต่อท้าย system prompt (ไม่ส่ง = เหมือนเดิม)
- Hook: `PCCommandHandler` เรียก module `pc-bridge` เมื่อมี (ไม่มี = ตอบ "Phase 4 ครับ" เหมือนเดิม)
- ADR-011 Phase 4: Shared Memory + Module System

### Changed
- `VoiceOrchestrator`: ผู้ให้บริการเสียงล้มทุกตัวเพราะยังไม่ได้ตั้งค่า (ไม่มี key / Expo STT ใช้ไม่ได้) → error kind `missing_key` แทน `server` · `sendMessage()` รับ `onSpeaking` (คืน false = ไม่พูดคำตอบ)
- core ไม่ import อะไรจาก `features/` แล้ว (ลบ `NOTE(arch)`); type module เดิมของ feature re-export จาก `core/types`
- ย้าย `loader.ts` จาก `src/core/modules/` → `src/modules/` · `AGENTS.md` ใช้ `@react-navigation/native-stack` ตาม ADR-009
- boot เรียก `moduleManager.start()` แทน `moduleRegistry.initAll()` ตรง ๆ · `loadModule()` ลงทะเบียนผ่าน `moduleManager` (ค่าที่บอสบันทึกไว้มีผลทันที)

### Fixed
- build Android ล้มเพราะ Gradle 9 ห้ามชื่อโปรเจกต์ `A.T.O.M.` (ขึ้นต้น/ลงท้ายด้วย ".") → `plugins/withAndroidProjectName.js` ตั้งชื่อ Gradle เป็น `atom`
- **Sync:** ของที่เครื่องอื่น push เข้ามาระหว่าง pull กับ push ของเราไม่หายแล้ว (`lastSyncAt` = เวลาตอน pull) · push ส่ง `lastSyncAt` ตอน pull ให้ server แยก conflict จริง → การลบ fact ที่ซิงก์แล้วไปถึงเครื่องอื่นได้ · server ปฏิเสธโดยไม่ส่งฉบับมา → ดึงใหม่ทั้งหมดรอบหน้า · กด "ล้างประวัติ" / เปิด auto-sync ก่อนค่าที่บันทึกไว้โหลดเสร็จ ไม่ถูกโหลดทับอีก · conflict log ที่โหลดมาเกิน 50 ถูกตัด
- `ModuleRegistry.initOne()`: module ที่ไม่มี dependency และ `init()` แบบ sync throw เคยทำให้ `pending` ค้าง → กด "เริ่มใหม่" หรือปิดแล้วเปิดใหม่ก็ไม่ init อีก · ตอนนี้เคลียร์ `pending` หลัง promise settle เสมอ

### Security
- `redactSecrets()` ซ่อน token เครื่องของ Mark 55 Bus (`atm_…`) ด้วย
- `redactSecrets` ปิดบัง AWS access key id (`AKIA` + 16) ด้วย · memory fact ผ่าน `toPromptLine()` (บีบ `\r \n \v \f` U+0085 U+2028 U+2029 ให้เป็นบรรทัดเดียว ทั้ง key และ value)

### Removed
- Demo greeting ของ Phase 2 (`useDemoGreeting`): แตะ Orb จะเข้าโหมดคุยแล้วเปิดช่องพิมพ์แทน ไม่ push คำทักทายอัตโนมัติอีก (`PERSONA_GREETINGS` ยังใช้ตอนสั่งสลับ persona)
- เอกสาร: `README.md` (เขียนใหม่), `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`
- JSDoc หัวไฟล์ของ `request.ts`, `ChatHistoryStorage.ts`, `IntentRouter.ts`, `Orchestrator.ts`, `VoiceOrchestrator.ts`

---

## [Phase 3 polish] — Q1–Q4 · 2026-10-14

งานเก็บความเรียบร้อยหลังปิด Phase 3: tests → refactor → types → error handling
ผลรวม: **327 tests ผ่านทั้งหมด** · coverage **97.3%** (statements) · tsc 0 errors · lint สะอาด

### Q4 — Error handling + Argon fixes (`c2e2293`, `d056271`)

#### Added
- `userAdvice(kind)` คำแนะนำภาษาไทยสำหรับ error ทุกประเภท แสดงบรรทัดแรกของข้อความเตือนในแชท
- Orchestrator: ถ้า key ถูกปฏิเสธ (401/403) แต่ provider ถัดไปตอบได้ จะแจ้งเตือนต่อท้ายคำตอบ (`takeNotices()`)
- error ประเภทใหม่ `permission` + `ensureMicPermission()` (ขอสิทธิ์ไมค์ผ่าน expo-audio, ข้อความไทย, ไม่ fallback)
- ตรวจออฟไลน์ด้วย `expo-network` (`isOffline()`) และแถบ **OfflineBanner** บนหน้าหลัก
- `ProviderSettings.isPersistent()` บอกว่าตอนนี้การตั้งค่าเก็บได้แค่ในหน่วยความจำหรือไม่
- ข้อความขอสิทธิ์ไมโครโฟนภาษาไทยใน `app.json` (มีผลหลัง build native ใหม่)
- Tests: `errorHandling.test.ts`, `storage.test.ts`, `sigv4.test.ts` (RFC 4231 / FIPS vectors, sessionToken, `!'()*`)

#### Changed
- error ที่รวมจากทุก provider (AI และเสียง) คง kind ร่วมไว้ เช่น ออฟไลน์ทุกเจ้า → `network` แทนที่จะเป็น `server` เสมอ
- ข้อความ network error เป็นภาษาไทย (`เชื่อมต่อเครือข่ายไม่ได้ (...)`)
- ข้อมูลที่เสีย (settings / ประวัติแชท) ถูกตัดทิ้งพร้อม `console.error` แทนการเงียบ

#### Fixed
- **TTS race:** `stop()` ระหว่าง synthesize ยังเล่นเสียงเก่าออกมา → เพิ่ม `runId` ทิ้งเสียงที่หมดอายุ
- **Mood race:** ส่งข้อความซ้อน 2 ครั้ง อันแรกที่เสร็จก่อน reset Orb เป็น `idle` ทั้งที่อันที่สองยังคิดอยู่ → เพิ่ม `activeTurn`
- **Settings write chain:** บันทึกการตั้งค่าล้มครั้งเดียว ทำให้ทุก setter หลังจากนั้นล้มตามหมด → ตอนนี้เก็บในหน่วยความจำต่อและไม่ reject

#### Security
- ปิดบัง API key (`sk-…`, `AIza…`) เป็น `[REDACTED]` ใน error ทุกทาง ก่อนแสดงผลและก่อนบันทึกลงประวัติแชท

### Q3 — Type safety (`1d553e2`)

#### Changed
- เปิด strict flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- `RouterOutput` เป็น discriminated union ตาม `intent` และ `dispatch` เป็น exhaustive switch
- อ่านข้อมูลข้ามขอบเขต (storage, network, LLM) ผ่าน runtime guards (`core/types/guards.ts`) แทน `as` cast
- unchecked casts ลดจาก 28 → 3 (ทั้ง 3 จุดมี comment อธิบาย) · `any` = 0

### Q2 — Refactor (`53f04da`)

#### Changed
- รวม helper ที่ซ้ำ: credentials, Azure token, `audioExtension`, `whileMounted`, `mergeOrder`, `voiceOptions`
- ย้าย `MainScreen` ไป `src/features/jarvis/screens/`
- ไม่มีไฟล์ยาวเกิน 300 บรรทัด และไม่เปลี่ยน behavior (258 tests ผ่านเท่าเดิม)

### Q1 — Tests + review fixes (`d81880b`, `6b5aed2`, `84792eb`, `19c3100`)

#### Added
- Unit tests: router, auto-switch (priority + fallback), persona voice map, chat history, voice settings — 258 tests
- เก็บประวัติแชทถาวรแยกต่อ persona (`atom.history.v1.<persona>`, สูงสุด 500 ข้อความ) โหลดตอนเปิดแอป
- Tests: Jev confidence = 0.7 พอดี และ lastGood sticky หลัง 429

#### Changed
- Jev ชนะเมื่อ confidence **≥** 0.7 (เดิม `>`)
- รวม import ของ storage ให้มาจาก `src/core/storage/` ที่เดียว

#### Fixed
- `BaseCloudTTS.speak()` resolve ก่อน reject เมื่อเล่นเสียงไม่ได้ ทำให้ VoiceOrchestrator ไม่ fallback
- สะกด "ไฟรเดย์" ใน persona prompt ให้ตรงกับ constants

---

## [Phase 3 Part 2] — 3d–3f: Router + Settings UI + Integration · 2026-10-14

### Added
- **3d Intent Router** (`1eb9680`) — `rule → Jev → LLM → default chat` · 3 intents: `chat`, `pc_command`, `switch_assistant`
  - `RuleClassifier` (regex ไทย/อังกฤษ) · `JevClassifier` (TypeSafe System One choice question) · `LLMClassifier` (Gemini/OpenRouter ตอบ JSON)
  - Handlers: `ChatHandler` (ส่งต่อ AI Orchestrator), `SwitchAssistantHandler`, `PCCommandHandler` (stub — "Phase 4 ครับ")
- **3e Settings UI** (`ff7b67e`) — หน้า Settings hub → AI Providers / Voice (TTS + STT) / Persona Voice Map
  - การ์ด provider: API key, เลือกโมเดล, เปิด/ปิด, ทดสอบการเชื่อมต่อ · Priority แบบลากเรียง · Advanced (timeout, retry, fallback)
  - Navigation ด้วย `@react-navigation/native-stack`
- **3f Persona switching** (`018a978`) — สลับ persona แล้วเปลี่ยน 4 อย่างพร้อมกัน: ประวัติแชท, Orb, **system prompt**, **เสียง TTS**
  - `personaPrompts.ts` + กติการ่วม (ตอบภาษาไทย สั้น เหมาะกับการอ่านออกเสียง)
  - `conversation.sendMessage()` เชื่อม router → handler → ประวัติแชท → พูดด้วยเสียงของ persona

---

## [Phase 3 Part 1] — 3a–3c: Framework + AI + Voice providers · 2026-10-14

### Added
- **3a Core frameworks** (`fcffcda`)
  - `ProviderRegistry` + `Orchestrator` (AI) · `VoiceRegistry` + `VoiceOrchestrator`
  - `SecureKeyStore` (expo-secure-store) · `ProviderSettings` (AsyncStorage)
  - `request()` พร้อม timeout และ `ProviderError` (auth / rate_limit / server / timeout / network / …)
- **3b AI providers** (`d5baeef`) — Gemini (`generateContent`), OpenRouter (OpenAI-compatible), Jev (TypeSafe System One — ใช้จำแนก intent เท่านั้น)
- **3c Voice providers** (`8904434`) — TTS 8 เจ้า + STT 8 เจ้า เรียกผ่าน `fetch()` ตรง
  - Amazon Polly ลงชื่อด้วย SigV4 ที่เขียนเองด้วย TypeScript ล้วน (`core/crypto/sigv4.ts`)
  - เล่นเสียงด้วย expo-audio + เขียนไฟล์ชั่วคราวด้วย expo-file-system

### Changed
- ใช้ **expo-audio** แทน expo-av ที่ระบุใน spec เพราะ expo-av ถูกถอดออกจาก SDK 57 ([ADR-010](docs/DECISIONS.md#adr-010--ใช้-expo-audio-แทน-expo-av))

---

## [Phase 2] — Core UI + Persona switching · 2026-10-14

### Added
- หน้าจอหลัก (แท็บ Atom) (`55562bb`, PR #1)
  - **Orb** WebGL shader ใน WebView (inline HTML ไม่พึ่ง CDN) + bridge queue ที่รอ WebView พร้อมก่อนส่งคำสั่ง
  - **Persona dropdown** สลับ 4 ผู้ช่วย · ประวัติแชทแยกต่อ persona (ตอนนั้นยังอยู่ในหน่วยความจำ)
  - Header, ActionBar, BottomTabs (Atom / Today / Memory), Reanimated transitions แบบ transform-only
  - Zustand store ที่ persist `activePersona`, `uiMode` และแท็บที่เลือก

### Fixed
- Blueprint compliance (`920fffa`): `window.setOrbAudio(level)` bridge (ใช้ `targetAudio`), WebView safety props, ปุ่ม History ใน Header, แถว "ประชุม" 🔒 ใน dropdown, ค่า `PERSONAS` / `LAYOUT` ที่ lock ไว้
- Dropdown pill แสดงเฉพาะชื่อไทย (`a1b942c`)

---

## [Phase 1] — Foundation · 2026-10-14

### Added
- โปรเจกต์ Expo SDK 57 + TypeScript (`55562bb`, เติมให้ครบใน `c397197`, PR #2)
- NativeWind v4 (Tailwind) · Reanimated 4 (babel-preset-expo ใส่ plugin ให้อัตโนมัติ) · Zustand 5
- react-native-screens · ESLint ผ่าน `expo lint` (eslint-config-expo)
- `AGENTS.md` กติกาการใช้ Expo CLI และ Continuous Native Generation
