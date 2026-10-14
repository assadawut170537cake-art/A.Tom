# A.T.O.M. (A.Tom)

> **AI โตไปด้วยกันกับ Boss** — ผู้ช่วย AI ส่วนตัวที่ "คุย" และ "พูด" เป็นภาษาไทย มี 4 บุคลิกให้สลับใช้ได้ทันที
> และค่อย ๆ เก่งขึ้นไปพร้อมกับบอสทีละ Phase

![Orb states](docs/orb-preview.png)

A.T.O.M. เป็นแอปมือถือ (iOS / Android) ที่รวมสามอย่างไว้ในหน้าจอเดียว:

- **Orb** วงกลมเรืองแสง (WebGL shader) ที่ขยับตามอารมณ์ของผู้ช่วย: `idle → listening → thinking → speaking`
- **แชท** ที่ส่งข้อความผ่าน Intent Router ไปหา LLM (Gemini / OpenRouter) พร้อม fallback อัตโนมัติ
- **เสียง** TTS 8 เจ้า และ STT 8 เจ้า เลือกเสียงแยกต่อ persona ได้

---

## สารบัญ

- [4 Personas](#4-personas)
- [Tech Stack](#tech-stack)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
- [เริ่มใช้งาน](#เริ่มใช้งาน)
- [การทดสอบ](#การทดสอบ)
- [Roadmap](#roadmap)
- [เอกสารเพิ่มเติม](#เอกสารเพิ่มเติม)

---

## 4 Personas

แต่ละ persona มี **ประวัติแชทแยกกัน**, **system prompt** ของตัวเอง, **สี Orb** และ **เสียง (TTS)** ที่ตั้งได้ในหน้า Persona Voice Map

| # | ชื่อ | EN | สี Orb | บุคลิก | System prompt (ย่อ) |
|:-:|------|----|--------|--------|---------------------|
| 1 | **อะตอม** | ATOM | 🟠 `#d35400` | นักเลง 2499 | พูดกวน ๆ ตรง ๆ แต่จริงใจ |
| 2 | **จาร์วิส** | JARVIS | 🔵 `#3b82f6` | พระเอกสุขุม | พูดนุ่ม ลึก |
| 3 | **ไฟรเดย์** | FRIDAY | 🩵 `#00d4ff` | เนี๊ยบ ไร้ที่ติ | กระชับ |
| 4 | **อัลตรอน** | ULTRON | 🔴 `#ff0033` | ดุดัน พร้อมบวก | ดุดัน แต่ยอม Boss |

สลับ persona ได้ 2 ทาง:

1. เลือกจาก dropdown ด้านบน (ตอนอยู่โหมด idle)
2. พิมพ์สั่ง เช่น *"เรียกจาร์วิส"*, *"เปลี่ยนเป็นไฟรเดย์"*, *"switch to ultron"* (Intent Router จะจับเป็น `switch_assistant`)

> ที่มา: `src/features/jarvis/constants/index.ts` และ `src/features/ai/prompts/personaPrompts.ts`

---

## Tech Stack

| ส่วน | เทคโนโลยี | หมายเหตุ |
|------|-----------|----------|
| Framework | **Expo SDK 57** · React Native 0.86 · React 19.2 | Continuous Native Generation (ไม่มี `ios/` `android/` ใน repo) |
| ภาษา | **TypeScript 6** (strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | ไม่มี `any` ไม่มี `@ts-ignore` |
| State | **Zustand 5** + `persist` (AsyncStorage) | `useAtomStore`, `useTabsStore` |
| Styling | **NativeWind v4** (Tailwind) | |
| Animation | **Reanimated 4** + react-native-worklets | transform-only transitions |
| Orb | **react-native-webview** + WebGL shader (inline HTML, ไม่พึ่ง CDN) | bridge: `setOrbState`, `setOrbAudio` |
| Navigation | @react-navigation/native-stack 7 | ดู [ADR-009](docs/DECISIONS.md#adr-009--navigation-ใช้-react-navigationnative-stack) |
| Storage | expo-secure-store (API keys) · AsyncStorage (settings, history) | ดู [ADR-002](docs/DECISIONS.md#adr-002--แยกที่เก็บ-secret-กับ-setting) |
| Audio | expo-audio (เล่นเสียง / ขอสิทธิ์ไมค์) · expo-speech (TTS บนเครื่อง) · expo-file-system | |
| Network | expo-network (ตรวจออฟไลน์) · `fetch()` ตรง ไม่ใช้ SDK ภายนอก | ดู [ADR-001](docs/DECISIONS.md#adr-001--เรียก-api-ด้วย-fetch-ตรง-ไม่ใช้-sdk-ภายนอก) |
| Test | Jest (jest-expo) · @testing-library/react-native 14 | |

**ผู้ให้บริการที่รองรับ**

| ประเภท | Providers |
|--------|-----------|
| LLM | Google Gemini · OpenRouter |
| Intent Router | Jev (TypeSafe System One) |
| TTS (8) | Expo Speech · OpenAI · ElevenLabs · Google Cloud · Azure · Amazon Polly · Play.ht · Custom (OpenAI-compatible) |
| STT (8) | Expo Speech Recognition · OpenAI Whisper · Deepgram · Google Cloud · Azure · AssemblyAI · Rev AI · Custom |

---

## โครงสร้างโปรเจกต์

```
src/
├── App.tsx                    # จุดเริ่ม: register providers → รอ hydrate store + โหลดประวัติแชท
├── navigation/                # RootNavigator (Main ↔ Settings stack)
│
├── core/                      # 🧱 โครงพื้นฐาน — ไม่รู้จัก feature ใด ๆ
│   ├── http/                  #   request() + ProviderError + redaction
│   ├── storage/               #   SecureKeyStore · ProviderSettings · ChatHistoryStorage · jsonStorage
│   ├── network/               #   isOffline()
│   ├── memory/                #   Shared Memory: MemoryStore · LocalMemoryAdapter · remote/sync stubs (Phase 4)
│   ├── modules/               #   Module System: AtomModule · ModuleRegistry (Phase 4)
│   ├── crypto/                #   SigV4 (สำหรับ Amazon Polly)
│   └── types/                 #   shared primitives (Persona, Message, provider ids) + runtime type guards
│
├── modules/                   # loader ของ module (stub) — ระดับแอป เพราะต้อง import จาก features/
│
├── features/                  # 🧩 module ตามโดเมน
│   ├── jarvis/                #   หน้าจอหลัก: Orb · แชท · store · conversation service
│   ├── router/                #   Intent Router: classifiers (Rule/Jev/LLM) + handlers
│   ├── ai/                    #   LLM: adapters · registry · Orchestrator · persona prompts
│   ├── voice/                 #   TTS 8 + STT 8 · registry · VoiceOrchestrator
│   └── settings/              #   หน้าตั้งค่า AI / Voice / Persona Voice Map
│
├── __tests__/                 # unit + integration tests
└── test-utils/                # mockFetch, setup helpers
```

ทำไมแยก `core/` กับ `features/` และแต่ละชั้นคุยกันอย่างไร → อ่าน [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## เริ่มใช้งาน

**ต้องมี:** Node.js 20+ และ npm

```bash
npm install
npx expo start          # เปิด dev server แล้วสแกน QR ด้วย Expo Go หรือ development build
```

| คำสั่ง | ใช้ทำอะไร |
|--------|-----------|
| `npx expo start` | dev server |
| `npx expo run:android` / `npx expo run:ios` | build + รันแบบ development build บนเครื่อง |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npx expo-doctor` | ตรวจ dependency / config |

> **เพิ่ม dependency** ใช้ `npx expo install <package>` เสมอ (ไม่ใช้ `npm install <package>`) เพื่อให้ได้เวอร์ชันที่ตรงกับ SDK 57 — ดู `AGENTS.md`

### ตั้งค่า API key

เปิดแอป → ไอคอน ⚙️ มุมขวาบน → **AI Providers** / **Voice**

- ใส่ key แล้วกด **ทดสอบการเชื่อมต่อ** — key ถูกเก็บใน SecureStore (เข้ารหัส, ผูกกับเครื่องนี้เท่านั้น: `THIS_DEVICE_ONLY`)
- ไม่มี key เลยก็ยังใช้ได้: เสียงจะใช้ Expo Speech บนเครื่อง แชทจะแจ้งให้ไปตั้งค่า key
- ปรับลำดับ provider (ลากเรียง), timeout, จำนวน retry และเปิด/ปิด fallback ได้ในหัวข้อ Advanced

---

## การทดสอบ

```bash
npm test                 # jest
npm run test:coverage    # jest --coverage
```

| ตัวชี้วัด (ณ Phase 3 polish) | ค่า |
|------------------------------|-----|
| Test suites | 12 |
| Tests | 327 ผ่านทั้งหมด |
| Coverage (statements) | 97.3% |
| Coverage threshold (บังคับใน `package.json`) | 70% ทุก metric |

ทุก test ใช้ `mockFetch` (ไม่ยิง API จริง) และ mock native modules ใน `jest.setup.js`

ก่อน commit ควรผ่านทั้ง 3 อย่าง: `npm run typecheck` · `npm run lint` · `npm test`

---

## Roadmap

| Phase | หัวข้อ | สถานะ |
|:-----:|--------|:-----:|
| 1 | **Foundation** — Expo SDK 57, TypeScript, NativeWind, Reanimated, Zustand, ESLint | ✅ เสร็จ |
| 2 | **Core UI** — หน้าจอหลัก, Orb (WebGL), dropdown สลับ 4 persona, แชทแยกต่อ persona | ✅ เสร็จ |
| 3 | **Brain + Voice** — AI providers + fallback, 16 voice providers, Intent Router, Settings UI, persona prompt/voice | ✅ เสร็จ |
| 3+ | **Polish (Q1–Q5)** — tests, refactor, strict types, error handling, documentation | ✅ เสร็จ |
| 4 | **Shared Memory** — local พร้อมใช้ (`LocalMemoryAdapter`), remote + sync เป็น stub · **Module System** — scaffold (`ModuleRegistry`, hook `pc-bridge` ใน `PCCommandHandler`, hook memory ใน `ChatHandler`) — ดู [ADR-011](docs/DECISIONS.md#adr-011--phase-4-shared-memory--module-system) | 🧱 scaffold |
| 4.5 | ต่อ UI จัดการความจำ / module · Remote memory + SyncQueue · module `pc-bridge` ตัวจริง (สั่งงานคอม) · รับเสียงพูดจริง (บันทึก → STT) | 🔜 ถัดไป |
| 5 | ยังไม่กำหนด scope (ตัวเลือกที่ค้างอยู่: โหมด "ประชุม" ใน dropdown, แท็บ Today / Memory) | 🗓️ วางแผน |

ประวัติการเปลี่ยนแปลงทั้งหมด → [CHANGELOG.md](CHANGELOG.md)

---

## เอกสารเพิ่มเติม

| เอกสาร | เนื้อหา |
|--------|---------|
| [CHANGELOG.md](CHANGELOG.md) | สิ่งที่เปลี่ยนในแต่ละ Phase (Keep a Changelog) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Core vs Module, Registry + DI, Orchestrator, data flow |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 10 lock decisions ของ Phase 3 + ADR-011 Phase 4 (ADR) |
| [AGENTS.md](AGENTS.md) | กติกาสำหรับ AI agent / ผู้ร่วมพัฒนา (Expo commands, CNG) |
