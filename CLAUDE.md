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

- **Runtime:** Expo + React Native + TypeScript (strict)
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
    │   ├── memory/     ← MemoryStore, LocalMemoryAdapter, RemoteMemoryAdapter (stub)
    │   └── modules/    ← AtomModule, ModuleRegistry
    │
    ├── modules/        ← loader.ts (stub) — ระดับแอป เพราะตาราง loader ต้อง import module จาก features/
    │
    └── features/       ← implementation (เปิด/ปิดได้)
        ├── ai/         ← providers, orchestrator, prompts
        ├── voice/      ← 16 providers (8 TTS + 8 STT), orchestrator
        ├── router/     ← IntentRouter, classifiers, handlers
        ├── jarvis/     ← MainScreen, conversation service
        └── settings/   ← screens, components

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
3. Voice: 16 providers (TTS 8 + STT 8), Expo Speech = ตัวสุดท้าย
4. Router: 3 intents — `chat` / `pc_command` / `switch_assistant`
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
   ⚠️ ยังไม่กรอง/ครอบ *เนื้อหา* ในบรรทัด — ทบทวนอีกครั้งก่อนเปิดให้ module เขียน memory ได้
3. ✅ ย้าย `loader.ts` → app-level (`src/modules/loader.ts`)

### ระหว่าง Phase 4.5
4. Remote Memory Adapter
5. SyncQueue.flush() + persist
6. Module `pc-bridge` จริง
7. UI Memory
8. UI Module Manager

### หลัง Phase 4.5
9. Prettier config + format
10. Module อื่นๆ

### Nice to Have
11. ✅ `SECRET_PATTERN` เพิ่ม `|AKIA[0-9A-Z]{16}`
12. ✅ `AGENTS.md` อัปเดตให้ตรง ADR-009

### Findings จาก Boss test (emulator) — ยังไม่ได้แก้
13. **Voice Persona Map default** — ถ้ายังไม่ได้ตั้ง Persona Voice Map ทุก persona พูดด้วยเสียง Expo Speech ค่าเริ่มต้นเดียวกัน
    (`resolveVoiceFor()` คืน `undefined` → ตกไปที่ Expo Speech ไม่ส่ง voice/speed/pitch) → ควรมีค่าเริ่มต้นต่อ persona
14. **Orb แยก shape/animation** — ตอนนี้ `setOrbPersona()` เปลี่ยนแค่สี shader/animation เหมือนกันทั้ง 4 ตัว → ต้องการรูปทรง/การเคลื่อนไหวเฉพาะ persona
15. **สี Atom vs Ultron ต่างชัด** — อะตอม `#d35400` (ส้มเข้ม) กับอัลตรอน `#ff0033` (แดง) ดูใกล้กันบนจอจริง → ต้องปรับให้แยกออกชัด
    (ค่า `PERSONAS` ถูก lock ไว้ตั้งแต่ Phase 2 — เปลี่ยนต้องให้ Boss อนุมัติ)

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
- Voice Orchestrator: `src/features/voice/core/VoiceOrchestrator.ts`
- Intent Router: `src/features/router/core/IntentRouter.ts`
- Memory: `src/core/memory/LocalMemoryAdapter.ts`
- Module: `src/core/modules/ModuleRegistry.ts` · loader: `src/modules/loader.ts`
- Shared types: `src/core/types/`

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
- Architecture: `docs/ARCHITECTURE.md`
- Changelog: `CHANGELOG.md`

---

**Last updated:** 2026-10-15 (Parking Lot ก่อน Phase 4.5: shared types, AKIA, loader, docs)
**Version:** 1.0
