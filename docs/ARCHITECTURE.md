# สถาปัตยกรรม A.T.O.M.

เอกสารนี้อธิบายว่าโค้ดถูกแบ่งอย่างไร แต่ละชั้นคุยกันแบบไหน และข้อความหนึ่งข้อความเดินทางจากนิ้วบอสไปถึง API แล้วกลับมาเป็นเสียงได้อย่างไร

> เกี่ยวข้อง: [README](../README.md) · [DECISIONS (ADR)](DECISIONS.md) · [CHANGELOG](../CHANGELOG.md)

## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [Core vs Module pattern](#2-core-vs-module-pattern)
3. [Registry pattern + Dependency Injection](#3-registry-pattern--dependency-injection)
4. [Orchestrator pattern (fallback chain)](#4-orchestrator-pattern-fallback-chain)
5. [Intent Router](#5-intent-router)
6. [Data flow: หนึ่งข้อความตั้งแต่ต้นจนจบ](#6-data-flow-หนึ่งข้อความตั้งแต่ต้นจนจบ)
7. [Storage](#7-storage)
8. [Error handling](#8-error-handling)
9. [แนวทางเพิ่มของใหม่](#9-แนวทางเพิ่มของใหม่)

---

## 1. ภาพรวม

```
┌──────────────────────────────────────────────────────────────────────┐
│  UI (React Native)                                                   │
│  MainScreen · Orb (WebView) · ChatLayer · Settings screens           │
└───────────────┬───────────────────────────────────────▲──────────────┘
                │ sendMessage(text)                     │ Zustand (useAtomStore)
┌───────────────▼───────────────────────────────────────┴──────────────┐
│  Service: conversation.ts  — คุมหนึ่ง "turn" ของบทสนทนา + mood ของ Orb  │
└───────┬───────────────────────────────────────────────────┬──────────┘
        │ handle()                                          │ speak()
┌───────▼─────────────┐   ┌──────────────────────┐   ┌──────▼──────────────┐
│  IntentRouter       │──▶│  AI Orchestrator     │   │  VoiceOrchestrator  │
│  Rule → Jev → LLM   │   │  fallback chain      │   │  TTS / STT chain    │
│  → Handler          │   └──────────┬───────────┘   └──────────┬──────────┘
└─────────────────────┘              │                          │
                          ┌──────────▼───────────┐   ┌──────────▼──────────┐
                          │  ProviderRegistry     │   │  VoiceRegistry      │
                          │  Gemini · OpenRouter  │   │  TTS ×8 · STT ×8    │
                          │  Jev                  │   │                     │
                          └──────────┬───────────┘   └──────────┬──────────┘
                                     └─────────────┬────────────┘
┌──────────────────────────────────────────────────▼───────────────────┐
│  core/ — request() · ProviderError · SecureKeyStore · ProviderSettings│
│          ChatHistoryStorage · isOffline() · SigV4 · type guards       │
└──────────────────────────────────────────────────┬───────────────────┘
                                                   ▼
                                    fetch() → Provider APIs (HTTPS)
```

---

## 2. Core vs Module pattern

โค้ดใน `src/` แบ่งเป็น 2 ชั้นที่มีกติกาต่างกันชัดเจน

| | `src/core/` 🧱 | `src/features/` 🧩 |
|---|---|---|
| **คืออะไร** | โครงพื้นฐานที่ใช้ได้กับทุก feature | module ตามโดเมน (หนึ่งเรื่อง = หนึ่งโฟลเดอร์) |
| **ตัวอย่าง** | `http/request.ts`, `storage/*`, `network/`, `crypto/sigv4.ts`, `types/guards.ts` | `jarvis/`, `router/`, `ai/`, `voice/`, `settings/` |
| **รู้จัก UI ไหม** | ❌ ไม่มี React / component | ✅ มีได้ (screens, components, stores) |
| **รู้จัก provider ไหม** | ❌ ไม่รู้ว่า Gemini หรือ Polly คืออะไร | ✅ adapter ของแต่ละเจ้าอยู่ที่นี่ |
| **import ทิศทาง** | ไม่ import runtime code จาก `features/` | import จาก `core/` ได้เสมอ |

### ทำไมต้องแยก

1. **เปลี่ยน feature ได้โดยไม่กระทบฐาน** — จะเพิ่ม TTS เจ้าที่ 9 หรือเปลี่ยน UI แชท ก็ไม่ต้องแตะ `request()` หรือ storage
2. **พฤติกรรมเหมือนกันทุกที่** — ทุก provider ใช้ `request()` ตัวเดียว จึงได้ timeout, การแปลง HTTP status เป็น `ProviderError`, ข้อความภาษาไทย และการปิดบัง API key เหมือนกันหมด
3. **test ง่าย** — `core/` เป็นฟังก์ชันล้วน mock แค่ `fetch` กับ AsyncStorage ก็ทดสอบได้ครบ
4. **กันวงจร import** — dependency ไหลทางเดียว `features → core`

### Shared types อยู่ใน `core/types/`

primitive ที่หลาย feature ใช้ร่วมกันอยู่ใน `core/types/` — core จึงไม่ต้อง import อะไรจาก `features/` เลย
(มี test `architecture.test.ts` คอยตรวจ ถ้ามีไฟล์ใน core import จาก features จะ fail)

| ไฟล์ | เนื้อหา |
|------|---------|
| `core/types/persona.ts` | `Persona`, `PERSONA_IDS`, `DEFAULT_PERSONA`, `isPersona` |
| `core/types/message.ts` | `Message`, `MessageRole`, `MESSAGE_ROLES` |
| `core/types/aiProvider.ts` | `AIProviderId` |
| `core/types/voiceProvider.ts` | `TTSProviderId`, `STTProviderId` |
| `core/types/guards.ts` | runtime type guards |

type module เดิมของ feature (`jarvis/types`, `ai/core/types`, `voice/core/types`) re-export ของเหล่านี้ไว้ ไฟล์ภายใน feature จึง import จากที่เดิมได้
ส่วนข้อมูลแสดงผลของ persona (ชื่อ สี คำทักทาย `USER_NAME`) ยังอยู่ที่ `features/jarvis/constants`

### ภายใน feature module

แต่ละ module ใช้โครงคล้ายกัน:

```
features/<module>/
├── core/          # types, interface, registry, orchestrator ของ module
├── adapters/      # (ai) หรือ tts/ stt/ (voice) — implementation รายเจ้า
├── index.ts       # public API: register*(), createProvider()
└── *.config.ts    # รายชื่อ provider + metadata
```

---

## 3. Registry pattern + Dependency Injection

### Registry

Registry คือ "สมุดรายชื่อ" provider ที่ลงทะเบียนตอนเปิดแอป — ผู้ใช้งานถามหาด้วย id ไม่ต้องรู้ว่าเป็น class อะไร

| Registry | ไฟล์ | เมธอด |
|----------|------|-------|
| `aiRegistry` | `features/ai/core/ProviderRegistry.ts` | `register` · `get(id)` · `list()` (ตามลำดับลงทะเบียน) · `listEnabled()` |
| `voiceRegistry` | `features/voice/core/VoiceRegistry.ts` | `registerTTS/STT` · `getTTS/STT(id)` · `listTTS/STT()` |

```
App.tsx (ครั้งเดียวตอน start)
  ├── registerAIProviders()     → PROVIDERS (providers.config.ts) → createProvider(config) → aiRegistry
  └── registerVoiceProviders()  → new ExpoSpeechTTS(), new OpenAITTS(), …        → voiceRegistry
```

- `createProvider()` เลือก adapter จาก `config.type` (`gemini` / `openai-compatible` / `systemone` / `custom`)
- ลงทะเบียน id ซ้ำ = แทนที่ตัวเดิม (idempotent — เรียกซ้ำใน test ได้)
- ทุก provider implement interface เดียวกัน (`AIProvider`, `TTSProvider`, `STTProvider`) Orchestrator จึงไม่ต้องรู้รายละเอียดของแต่ละเจ้า

### Dependency Injection (แบบ constructor + ค่า default)

ไม่ใช้ DI container — ใช้ **constructor parameter ที่มีค่า default เป็น singleton** แทน
โค้ดแอปเรียกแบบไม่ส่งอะไร ส่วน test ฉีดของปลอมเข้าไปได้

```ts
export class Orchestrator {
  constructor(
    private readonly registry: ProviderRegistry = aiRegistry,          // ค่าจริง
    private readonly settings: ProviderSettingsStore = ProviderSettings,
  ) {}
}

// แอป
export const aiOrchestrator = new Orchestrator();

// test
const registry = new ProviderRegistry();
registry.register(fakeProvider('gemini', ['rate_limit', 'ok']));
const orch = new Orchestrator(registry);
```

| Class | dependency ที่ฉีดได้ |
|-------|---------------------|
| `Orchestrator` | registry, settings |
| `VoiceOrchestrator` | registry, settings |
| `IntentRouter` | `rule`, `jev`, `llm` classifiers, `handlers` |
| `JevClassifier` | registry, settings |
| `LLMClassifier` / `ChatHandler` | orchestrator (และ prompt source สำหรับ ChatHandler) |

---

## 4. Orchestrator pattern (fallback chain)

Orchestrator คือตัวกลางที่เลือก provider ตามลำดับ แล้ว **ลองตัวถัดไปเมื่อตัวก่อนหน้าล้มด้วยเหตุที่ตัวอื่นอาจทำได้**

### AI Orchestrator — `features/ai/core/Orchestrator.ts`

**ลำดับการลอง** (เฉพาะ provider ที่เปิดอยู่ และ `purpose = 'llm'` — Jev ไม่อยู่ในสายนี้):

```
pinned provider (ถ้าระบุ)
  → lastGood (ตัวที่สำเร็จล่าสุด — "sticky")
    → priority ที่บอสลากเรียงไว้
      → ลำดับการลงทะเบียน
```

**ทำอะไรกับ error แต่ละแบบ**

| Error | HTTP | Retry ตัวเดิม? | Fallback ตัวถัดไป? | หมายเหตุ |
|-------|------|:--------------:|:------------------:|----------|
| `auth` | 401 / 403 / Google `API_KEY_INVALID` | ❌ | ✅ | ถ้าตัวถัดไปตอบได้ → แจ้งเตือน key เสีย (`takeNotices()`) |
| `rate_limit` | 429 | ✅ | ✅ | |
| `server` | 5xx | ✅ | ✅ | |
| `timeout` | — | ✅ | ✅ | ตาม Advanced → timeout |
| `network` | — | ✅ | ✅ | |
| `missing_key` | — | ❌ | ✅ | ไม่ยิง request เลย |
| `bad_request` | 4xx อื่น | ❌ | ❌ | โยนออกทันที (ตัวอื่นก็น่าจะล้มเหมือนกัน) |
| `invalid_response` | — | ❌ | ❌ | |

- จำนวน retry และหน่วงเวลา (`800ms × ครั้งที่`) ตั้งได้ใน Advanced · ปิด fallback ได้ (ลองแค่ตัวแรก)
- ล้มทุกตัว → `ProviderError('orchestrator', kind, 'ผู้ให้บริการทุกรายล้มเหลว: …')` โดย `kind` = kind ร่วมถ้าทุกตัวล้มแบบเดียวกัน (เช่น ออฟไลน์ทั้งหมด → `network`) ไม่งั้นเป็น `server`
- ตัวที่สำเร็จจะกลายเป็น `lastGood` และถูกลืมทันทีที่ล้ม

```
chat()
 ├─ gemini  ── 429 ──▶ retry? ── 429 ──▶ (บันทึก failure)
 ├─ openrouter ─ 200 ─▶ lastGood = openrouter ─▶ return ✅
 └─ (ไม่ถึง)
```

### Voice Orchestrator — `features/voice/core/VoiceOrchestrator.ts`

| | ลำดับการลอง |
|---|---|
| **TTS** `speak(text, persona)` | เสียงของ persona (หรือเสียงรวมถ้าเปิด "ใช้ voice เดียวกันทุก persona") → TTS priority → ลำดับลงทะเบียน → **Expo Speech เป็นตัวสุดท้ายเสมอ** (แม้จะปิดไว้) |
| **STT** `listen(uri)` | STT ที่เลือก → STT priority → ที่เหลือ (เฉพาะที่เปิด) |

- เงื่อนไข fallback ใช้ `ProviderError.shouldFallback` ชุดเดียวกับ AI
- `permission` (ไม่ได้สิทธิ์ไมค์) และ `bad_request` (เช่น ไฟล์เสียงหาย) **ไม่ fallback** เพราะเจ้าอื่นก็ทำไม่ได้
- persona voice ใช้ voiceId / speed / pitch ของ persona ส่วนตัวสำรองใช้เสียง default ของตัวเอง

---

## 5. Intent Router

`features/router/core/IntentRouter.ts` — ตัดสินว่าข้อความนี้ "ต้องการอะไร" ก่อนส่งให้ handler

```
text ─▶ RuleClassifier (regex, ฟรี, ไม่ใช้เน็ต)
          │ match → จบ
          ▼
        JevClassifier (เฉพาะเมื่อเปิด Jev)
          │ confidence ≥ 0.7 → จบ
          ▼
        LLMClassifier (ถาม AI Orchestrator ให้ตอบ JSON {intent, confidence})
          │ ได้ intent ที่รู้จัก → จบ
          ▼
        default → { intent: 'chat', confidence: 0.5, provider: 'rule' }
```

- classifier ล้มหรือตอบ intent ที่ไม่รู้จัก → **ตกไปขั้นถัดไปเสมอ** ผู้ใช้ไม่โดนบล็อก
- `RouterOutput` เป็น discriminated union ตาม `intent` → `dispatch()` เป็น exhaustive switch (เพิ่ม intent ใหม่แล้วลืมเขียน handler = compile error)

| Intent | Handler | ทำอะไร |
|--------|---------|--------|
| `chat` | `ChatHandler` | system prompt ของ persona + ประวัติ 20 ข้อความล่าสุด → AI Orchestrator |
| `switch_assistant` | `SwitchAssistantHandler` | เปลี่ยน `activePersona` แล้วตอบด้วยคำทักทายของ persona ใหม่ |
| `pc_command` | `PCCommandHandler` | ส่งต่อ module `pc-bridge` ถ้าลงทะเบียนและเปิดไว้ ไม่งั้นตอบ stub "Phase 4 ครับ" ([ADR-011](DECISIONS.md#adr-011--phase-4-shared-memory--module-system)) |

เหตุผลของลำดับและเกณฑ์ 0.7 → [ADR-005](DECISIONS.md#adr-005--intent-router-rule--jev--llm--chat) · [ADR-006](DECISIONS.md#adr-006--jev-ใช้จำแนก-intent-เท่านั้น)

---

## 6. Data flow: หนึ่งข้อความตั้งแต่ต้นจนจบ

ลำดับหลัก: **User input → Router → Handler → Service → Provider → API**

ตัวอย่าง: บอสพิมพ์ *"วันนี้เป็นไงบ้าง"* ขณะคุยกับอะตอม (persona 1)

```
 ① User input
    MainScreen ─ sendMessage("วันนี้เป็นไงบ้าง")                 features/jarvis/services/conversation.ts
      ├─ pushMessage(user)           → useAtomStore → ChatHistoryStorage.save(1)
      ├─ setUIMode('conversation')
      └─ setMood('thinking')         → Orb (WebView bridge)
                │
 ② Router       ▼
    IntentRouter.handle()                                          features/router/core/IntentRouter.ts
      ├─ RuleClassifier.check()     → ไม่ match
      ├─ JevClassifier              → ปิดอยู่ → null
      └─ LLMClassifier              → aiOrchestrator.chat(classifier prompt) → { intent: 'chat' }
                │
 ③ Handler      ▼
    ChatHandler.handle()                                           features/router/handlers/ChatHandler.ts
      └─ messages = [system: prompt อะตอม, …ประวัติ 20 ล่าสุด, user: ข้อความ]
                │
 ④ Service      ▼
    aiOrchestrator.chat({ messages })                              features/ai/core/Orchestrator.ts
      └─ chain: lastGood → priority → registry
                │
 ⑤ Provider     ▼
    GeminiAdapter.chat()                                           features/ai/adapters/GeminiAdapter.ts
      └─ key จาก SecureKeyStore · model จาก ProviderSettings
                │
 ⑥ API          ▼
    request() → fetch(POST …/models/gemini-3-flash:generateContent)   core/http/request.ts
      └─ timeout · HTTP status → ProviderError · redact key
                │
                ▼  (ย้อนกลับ)
    conversation.ts
      ├─ pushMessage(assistant, persona = result.persona)    → บันทึกประวัติ
      ├─ takeNotices() → ⚠️ แจ้งเตือน key เสีย (ถ้ามี)
      ├─ setMood('speaking')                                 (เฉพาะ turn ล่าสุด)
      ├─ voiceOrchestrator.speak(reply, persona)             → TTS provider → expo-audio / expo-speech
      └─ finally: setMood('idle')                            (เฉพาะ turn ล่าสุด)
```

**กรณีล้ม:** ทุกขั้นโยน `ProviderError` ขึ้นมาถึง `conversation.ts` ซึ่งจับไว้ แล้วเพิ่มข้อความ `system` ลงประวัติ:
บรรทัดแรกเป็นคำแนะนำภาษาไทย (`userAdvice(kind)`) และบรรทัดถัดไปเป็นรายละเอียดที่ปิดบัง key แล้ว
ถ้าเป็น network error หรือเครื่องรายงานว่าออฟไลน์ ข้อความจะบอกว่า "ไม่มีการเชื่อมต่ออินเทอร์เน็ต" — แอปไม่ crash และ Orb กลับเป็น `idle`

**กรณีสลับ persona:** *"เรียกจาร์วิส"* → RuleClassifier จับเป็น `switch_assistant` (ไม่ใช้เน็ต) → `SwitchAssistantHandler` → `setActivePersona(2)` (หยุดเสียงเดิม, เปลี่ยน system prompt, โหลดเสียงใหม่) → คำทักทายของจาร์วิสถูกบันทึกในประวัติ **ของจาร์วิส**

---

## 7. Storage

| ข้อมูล | ที่เก็บ | key | ไฟล์ |
|--------|---------|-----|------|
| API keys / secrets | **SecureStore** (เข้ารหัส, `THIS_DEVICE_ONLY`) | `atom.secret.<scope>.<id>[.field]` | `core/storage/SecureKeyStore.ts` |
| การตั้งค่า (enabled, priority, model, voice map, advanced) | AsyncStorage (JSON ก้อนเดียว + cache ในหน่วยความจำ) | `atom.providerSettings.v1` | `core/storage/ProviderSettings.ts` |
| ประวัติแชท | AsyncStorage แยก key ต่อ persona (สูงสุด 500 ข้อความ) | `atom.history.v1.<1-4>` | `core/storage/ChatHistoryStorage.ts` |
| persona / uiMode ที่เลือก | AsyncStorage ผ่าน Zustand `persist` | `atom-store` | `features/jarvis/stores/useAtomStore.ts` |

**เมื่อ storage มีปัญหา**

- อ่าน / เขียนไม่ได้ → ใช้หน่วยความจำต่อ และตั้ง flag (`ProviderSettings.isPersistent()`, `historyPersisted`)
- ข้อมูลเสีย → ตัดทิ้งเฉพาะส่วนที่เสีย (field หรือข้อความที่ผิดรูปแบบ) พร้อม `console.error` แล้วใช้ค่าเริ่มต้นแทน
- การเขียนแต่ละครั้งเข้าคิว (settings: write chain, history: คิวต่อ persona) จึงไม่ทับกัน

---

## 8. Error handling

ทุก error จาก provider เป็น `ProviderError` (`core/http/errors.ts`) ที่มี `providerId`, `kind`, `status` และ message รูปแบบ `[providerId] …`

| ชั้น | หน้าที่ |
|------|--------|
| `request()` | timeout (AbortController) · HTTP status → `kind` · ดึงข้อความจาก body · **redact `sk-…` / `AIza…`** |
| Adapter | ตรวจ response แล้วโยน `invalid_response` / `missing_key` |
| Orchestrator | retry / fallback ตามตารางในหัวข้อ 4 · รวม error ของทุกเจ้า |
| IntentRouter | classifier ล้ม → ขั้นถัดไป (ไม่โยน) |
| conversation.ts | จับทุกอย่าง → ข้อความไทยในแชท · ไม่ crash · mood กลับ `idle` |

---

## 9. แนวทางเพิ่มของใหม่

| อยากเพิ่ม | ทำที่ไหน |
|-----------|---------|
| LLM เจ้าใหม่ (OpenAI-compatible) | เพิ่ม config ใน `features/ai/providers.config.ts` + id ใน `AIProviderId` |
| LLM ที่ API ไม่เหมือนใคร | สร้าง adapter ใน `features/ai/adapters/` (extends `BaseAIProvider`) + case ใน `createProvider()` |
| TTS / STT เจ้าใหม่ | class ใน `features/voice/tts|stt/` (extends `BaseCloudTTS` / `BaseCloudSTT`) + ลงทะเบียนใน `registerVoiceProviders()` + `voice.config.ts` |
| Intent ใหม่ | เพิ่มใน `INTENTS` + entity type → compiler จะบังคับให้เพิ่ม handler และ case ใน `dispatch()` |
| ของที่ทุก feature ใช้ร่วม | `src/core/` (ห้ามมี React และห้ามรู้จัก provider) |

ทุกครั้ง: เรียก HTTP ผ่าน `request()` / `requestJson()` / `requestBytes()` เท่านั้น เพื่อให้ได้ timeout, error mapping และ redaction อัตโนมัติ
