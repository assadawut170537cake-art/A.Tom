# Changelog

บันทึกการเปลี่ยนแปลงทั้งหมดของ A.T.O.M. เรียงจากใหม่ไปเก่า

รูปแบบอิง [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — หัวข้อใช้ชื่อ Phase แทนเลขเวอร์ชัน
(แอปยังไม่ได้ออก release; `package.json` ยังเป็น `1.0.0`) แต่ละหัวข้อแบ่งเป็น
**Added** · **Changed** · **Fixed** · **Removed** · **Security**

ภาพรวมสถาปัตยกรรม → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · เหตุผลของการตัดสินใจ → [docs/DECISIONS.md](docs/DECISIONS.md)

---

## [Unreleased]

### Added
- **Chat UI จริง:** `ChatInput` (พิมพ์ได้หลายบรรทัด สูงสุด 4 บรรทัด, ปุ่มส่งสีตาม persona) ต่อเข้ากับ `sendMessage()` · ปุ่ม ⌨️ โฟกัสช่องพิมพ์ · แถบเตือน "ยังไม่ได้ตั้งค่า API key" แตะแล้วไปหน้า AI Providers
- **Phase 4 scaffold — Shared Memory** (`src/core/memory/`): `MemoryStore` interface, `LocalMemoryAdapter` (AsyncStorage `atom.memory.v1.<scope>.<key>`, fallback ในหน่วยความจำ), `RemoteMemoryAdapter` (stub), `SyncQueue` (skeleton offline-first)
- **Phase 4 scaffold — Module System** (`src/core/modules/`): `AtomModule`, `ModuleRegistry` (init ตาม dependency, dispose ย้อนลำดับ), `loader.ts` (stub)
- Hook: `ChatHandler` รับ `memoryStore` แล้วแนบ facts ต่อท้าย system prompt (ไม่ส่ง = เหมือนเดิม)
- Hook: `PCCommandHandler` เรียก module `pc-bridge` เมื่อมี (ไม่มี = ตอบ "Phase 4 ครับ" เหมือนเดิม)
- ADR-011 Phase 4: Shared Memory + Module System

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
