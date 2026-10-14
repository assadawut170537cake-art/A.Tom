# Architecture Decision Records

ADR-001 – 010: การตัดสินใจที่ **lock** ไว้ใน Phase 3 · ADR-011 ขึ้นไป: Phase 4

10 การตัดสินใจที่ **lock** ไว้ใน Phase 3 แต่ละข้อเขียนในรูปแบบ ADR:
**Decision** · **Status** · **Context** · **Rationale** · **Consequences**

> **ที่มาของรายการ:** เอกสาร handoff ต้นฉบับไม่ได้อยู่ใน repo
> รายการนี้จึงเรียบเรียงจาก spec ของ Phase 3 Part 1/2 (3a–3c) และ Part 2/2 (3d–3f), รอบ review ของ Argon และโค้ดที่ merge แล้ว
> **ถ้าเลขข้อหรือเนื้อหาไม่ตรงกับ handoff ให้แก้ไฟล์นี้ตาม handoff** — โค้ดและเหตุผลในแต่ละข้อตรวจกับ `main` แล้ว

> เกี่ยวข้อง: [ARCHITECTURE.md](ARCHITECTURE.md) · [CHANGELOG](../CHANGELOG.md) · [README](../README.md)

## สรุป

| # | Decision | Status | ไฟล์หลัก |
|:-:|----------|:------:|----------|
| [001](#adr-001--เรียก-api-ด้วย-fetch-ตรง-ไม่ใช้-sdk-ภายนอก) | เรียก API ด้วย `fetch()` ตรง ไม่ใช้ SDK ภายนอก | ✅ Accepted | `core/http/request.ts` |
| [002](#adr-002--แยกที่เก็บ-secret-กับ-setting) | Secret → SecureStore · Setting → AsyncStorage | ✅ Accepted | `core/storage/*` |
| [003](#adr-003--ประวัติแชทแยกต่อ-persona-และเก็บถาวร) | ประวัติแชทแยกต่อ persona และเก็บถาวร | ✅ Accepted | `ChatHistoryStorage.ts` |
| [004](#adr-004--สลับ-persona--เปลี่ยน-4-อย่างพร้อมกัน) | สลับ persona = เปลี่ยน 4 อย่างพร้อมกัน | ✅ Accepted | `useAtomStore.ts` |
| [005](#adr-005--intent-router-rule--jev--llm--chat) | Intent Router: Rule → Jev → LLM → Chat | ✅ Accepted | `IntentRouter.ts` |
| [006](#adr-006--jev-ใช้จำแนก-intent-เท่านั้น) | Jev ใช้จำแนก intent เท่านั้น | ✅ Accepted | `JevAdapter.ts` |
| [007](#adr-007--ai-fallback-chain-แบบ-sticky) | AI fallback chain แบบ sticky | ✅ Accepted | `Orchestrator.ts` |
| [008](#adr-008--expo-speech-เป็น-tts-สำรองสุดท้ายเสมอ) | Expo Speech เป็น TTS สำรองสุดท้ายเสมอ | ✅ Accepted | `VoiceOrchestrator.ts` |
| [009](#adr-009--navigation-ใช้-react-navigationnative-stack) | Navigation ใช้ `@react-navigation/native-stack` | ✅ Accepted | `navigation/*` |
| [010](#adr-010--ใช้-expo-audio-แทน-expo-av) | ใช้ expo-audio แทน expo-av | ✅ Accepted | `TTSInterface.ts` |
| [011](#adr-011--phase-4-shared-memory--module-system) | Phase 4: Shared Memory + Module System | 🧱 Accepted (scaffold) | `core/memory/*`, `core/modules/*` |

---

## ADR-001 — เรียก API ด้วย fetch() ตรง ไม่ใช้ SDK ภายนอก

| | |
|---|---|
| **Decision** | ทุก provider (AI 3 + TTS 8 + STT 8) เรียก HTTP ผ่าน `request()` ใน `core/http/request.ts` ซึ่งห่อ `fetch()` ไม่ติดตั้ง SDK ของผู้ให้บริการใด ๆ |
| **Status** | ✅ Accepted — Phase 3a/3b/3c |
| **Context** | ต้องรองรับ 19 ผู้ให้บริการ SDK ส่วนใหญ่ออกแบบมาสำหรับ Node.js (พึ่ง `crypto`, `stream`, `Buffer`) ซึ่งไม่มีใน React Native และจะทำให้ bundle ใหญ่ขึ้นมาก |
| **Rationale** | • ควบคุม timeout, retry และการแปลง error ได้ที่จุดเดียว<br>• error ทุกเจ้าเป็น `ProviderError` รูปแบบเดียว → Orchestrator ตัดสินใจ fallback ได้เหมือนกัน<br>• ไม่มี dependency ที่ต้องตามอัปเดต / ไม่มี native module เพิ่ม<br>• `fetch` ของ Expo SDK 57 (WinterCG) รองรับ `arrayBuffer()` และ `FormData` + `Blob` ครบ |
| **Consequences** | ➕ bundle เล็ก, behavior เดียวกันทุกเจ้า, mock ใน test ง่าย (`mockFetch`)<br>➖ ต้องเขียน request/response mapping เอง และตามการเปลี่ยน API ของแต่ละเจ้าเอง<br>➖ Amazon Polly ต้องเขียน SigV4 เอง (`core/crypto/sigv4.ts`, ทดสอบกับ AWS vector + RFC 4231) |

---

## ADR-002 — แยกที่เก็บ secret กับ setting

| | |
|---|---|
| **Decision** | API key และ credential ทุกชนิด → **expo-secure-store** (`SecureKeyStore`, `THIS_DEVICE_ONLY`) · การตั้งค่าที่ไม่ลับ → **AsyncStorage** (`ProviderSettings`, JSON ก้อนเดียว) |
| **Status** | ✅ Accepted — Phase 3a |
| **Context** | ต้องเก็บ key ของ 19 เจ้า และการตั้งค่าอีกจำนวนมาก (เปิด/ปิด, ลำดับ, โมเดล, เสียงต่อ persona, timeout) SecureStore เข้ารหัสแต่ช้าและจำกัดขนาดต่อค่า AsyncStorage เร็วแต่ไม่เข้ารหัส |
| **Rationale** | • key ไม่เคยอยู่ใน storage ที่อ่านได้ตรง ๆ และไม่ติดไปกับ backup ข้ามเครื่อง<br>• setting อ่านบ่อย → cache ในหน่วยความจำหลังอ่านครั้งแรก<br>• ชื่อ key ใน SecureStore มีรูปแบบตายตัว `atom.secret.<scope>.<id>[.field]` และตรวจด้วย regex |
| **Consequences** | ➕ ปลอดภัยตามมาตรฐาน OS (Keychain / Keystore)<br>➖ ย้ายเครื่องแล้วต้องใส่ key ใหม่<br>➖ ข้อมูลสองที่ต้อง reset แยกกัน (test ใช้ `resetSettings()` + `setAIKeys()`)<br>🔒 error message ที่อาจมี key ถูก redact ก่อนบันทึก (Q4) |

---

## ADR-003 — ประวัติแชทแยกต่อ persona และเก็บถาวร

| | |
|---|---|
| **Decision** | แต่ละ persona มีประวัติแชทของตัวเอง ไม่ปนกัน (Boss lock) และบันทึกลง AsyncStorage **หนึ่ง key ต่อ persona** (`atom.history.v1.<persona>`) เก็บล่าสุดไม่เกิน 500 ข้อความ |
| **Status** | ✅ Accepted — แยกต่อ persona ตั้งแต่ Phase 2 · เก็บถาวรเพิ่มใน Phase 3 fix (`6b5aed2`) |
| **Context** | ผู้ช่วยแต่ละตัวมีบุคลิกต่างกัน ถ้าใช้ประวัติร่วม คำตอบของอะตอมจะไปอยู่ใน context ของไฟรเดย์ ช่วงแรกประวัติอยู่ในหน่วยความจำและหายเมื่อปิดแอป |
| **Rationale** | • key แยกต่อ persona → บันทึกเฉพาะ persona ที่เปลี่ยน ไม่ต้องเขียนทั้งก้อน<br>• จำกัด 500 ข้อความ → ห่างจากขีดจำกัดขนาดของ AsyncStorage บน Android<br>• คิวการเขียนต่อ persona → บันทึกตามลำดับ ไม่ทับกัน<br>• App รอโหลดประวัติเสร็จก่อน render (`historyLoaded`) และ merge กับข้อความที่เกิดระหว่างโหลด |
| **Consequences** | ➕ สลับ persona แล้วบทสนทนาเดิมยังอยู่ · ปิด/เปิดแอปไม่หาย<br>➖ ข้อความเก่ากว่า 500 ถูกตัดทิ้ง<br>➖ storage เสีย → ทำงานในหน่วยความจำ (`historyPersisted = false`) · ข้อมูลเสียถูกตัดทิ้งพร้อม `console.error` |

---

## ADR-004 — สลับ persona = เปลี่ยน 4 อย่างพร้อมกัน

| | |
|---|---|
| **Decision** | `setActivePersona()` เปลี่ยน **ประวัติแชท · Orb · system prompt · เสียง TTS** ในครั้งเดียว |
| **Status** | ✅ Accepted — Phase 3f |
| **Context** | Phase 2 สลับได้แค่ประวัติแชทกับสี Orb แต่ถ้า prompt และเสียงไม่ตาม ผู้ช่วยทุกตัวจะพูดเหมือนกัน |
| **Rationale** | • prompt มาจาก `personaPrompts.ts` (ข้อความที่บอสอนุมัติ) + กติการ่วม: ตอบไทย สั้น เหมาะกับการอ่านออกเสียง<br>• เสียงมาจาก Persona Voice Map (`resolveVoiceFor`) หรือเสียงรวมถ้าเปิด "ใช้ voice เดียวกันทุก persona"<br>• หยุดเสียงที่กำลังพูดก่อนสลับ · ผลการโหลดเสียงที่ช้ากว่าการสลับครั้งถัดไปถูกทิ้ง<br>• สลับด้วยคำพูดได้ ("เรียกจาร์วิส") — คำทักทายของ persona ใหม่ไปอยู่ในประวัติ **ของ persona ใหม่** |
| **Consequences** | ➕ แต่ละตัวมีตัวตนครบทั้งข้อความและเสียง<br>➖ เพิ่ม persona ที่ 5 ต้องแก้หลายที่ (constants, prompts, regex ของ RuleClassifier, criteria ของ Jev) |

---

## ADR-005 — Intent Router: Rule → Jev → LLM → Chat

| | |
|---|---|
| **Decision** | จำแนก intent ตามลำดับ **Rule (regex) → Jev (เมื่อเปิด, confidence ≥ 0.7) → LLM classifier → default `chat`** · intent มี 3 แบบ: `chat`, `pc_command`, `switch_assistant` |
| **Status** | ✅ Accepted — Phase 3d · เกณฑ์ Jev เปลี่ยนจาก `> 0.7` เป็น `≥ 0.7` ใน `84792eb` |
| **Context** | คำสั่งส่วนใหญ่ชัดเจน (เช่น "เรียกจาร์วิส", "ปิดคอม") ไม่จำเป็นต้องเสียเงินและเวลาเรียก AI แต่ประโยคกำกวมต้องใช้โมเดลช่วย |
| **Rationale** | • Rule ฟรี เร็ว ใช้ได้แม้ออฟไลน์ → ใส่ไว้ก่อน (regex บังคับ verb มาก่อนชื่อ กันจับผิด)<br>• Jev ถูกออกแบบมาเพื่อ classification โดยเฉพาะ จึงถูกกว่า LLM ทั่วไป<br>• 0.7 ถือว่า "มั่นใจพอ" และค่า 0.7 พอดีนับว่าผ่าน (มี boundary test)<br>• classifier ล้มหรือตอบ intent ที่ไม่รู้จัก → ขั้นถัดไป · สุดท้ายเป็น `chat` เสมอ ผู้ใช้ไม่โดนบล็อก |
| **Consequences** | ➕ ประหยัด · ทนทาน · ข้อความทุกข้อความได้คำตอบ<br>➖ ประโยคกำกวมอาจใช้ 2 request (classify + chat)<br>➖ regex ต้องดูแลเมื่อเพิ่มชื่อเล่นหรือคำสั่งใหม่<br>🔧 `RouterOutput` เป็น discriminated union → เพิ่ม intent แล้วลืม handler = compile error |

---

## ADR-006 — Jev ใช้จำแนก intent เท่านั้น

| | |
|---|---|
| **Decision** | Jev (TypeSafe System One) มี `purpose: 'router'`, **ปิดไว้เป็นค่าเริ่มต้น** และไม่อยู่ใน chat fallback chain — `chat()` ของ Jev โยน `unsupported` |
| **Status** | ✅ Accepted — Phase 3b (adapter สร้างตาม OpenAPI จริง v0.2.0) |
| **Context** | spec แรกให้ Jev มี `chat()` แต่ API จริง (`POST /v1/systemone`) รับ `state` + `questions` (choice / score / noul) แล้วตอบเป็น answer ที่มี confidence — ไม่ใช่ chat completion |
| **Rationale** | • ใช้ Jev ตรงกับจุดแข็ง: ถาม choice question ว่าข้อความนี้เป็น intent ไหน พร้อม criteria ของแต่ละ intent<br>• กันไม่ให้ Orchestrator ส่งบทสนทนาไปหา API ที่ตอบไม่ได้<br>• ปิดไว้ก่อนเพราะเป็นบริการเสริม — ไม่มี key ก็ยังจำแนกได้ด้วย Rule + LLM |
| **Consequences** | ➕ Jev ล้ม / ปิด / ไม่มี key → Gemini จำแนกแทนอัตโนมัติ (มี test ครบ 3 กรณี)<br>➖ ถ้าอนาคตอยากใช้ Jev ตอบคำถามด้วย ต้องเพิ่ม purpose ใหม่ |

---

## ADR-007 — AI fallback chain แบบ sticky

| | |
|---|---|
| **Decision** | ลอง provider ตามลำดับ **pinned → lastGood → priority ของบอส → ลำดับลงทะเบียน** · fallback เมื่อ 401/403/429/5xx/timeout/network/ไม่มี key · retry เฉพาะ 429/5xx/timeout/network · 400 อื่น ๆ โยนออกทันที |
| **Status** | ✅ Accepted — Phase 3a · แจ้งเตือน key เสียและ kind ร่วมเพิ่มใน Q4 |
| **Context** | spec กำหนด "ลองตาม priority → fallback, cache provider ที่สำเร็จ, fail เมื่อ 401/429/500/503/timeout" ผู้ใช้ทั่วไปมี key แค่บางเจ้า และ free tier มักโดน rate limit |
| **Rationale** | • **sticky (lastGood):** เจ้าที่เพิ่งโดน 429 ไม่ควรถูกยิงซ้ำทุกข้อความ — ใช้ตัวที่เพิ่งสำเร็จต่อจนกว่าจะล้ม<br>• **ไม่ retry 401/403:** key ผิดไม่หายเองถ้ายิงซ้ำ แต่ยัง fallback ได้ และแจ้งบอสว่า key ไหนเสีย<br>• **ไม่ fallback 400:** คำขอผิดรูปแบบมักผิดกับทุกเจ้า fallback ไปก็เสียเวลาเปล่า<br>• timeout / retry / เปิด-ปิด fallback ปรับได้ใน Advanced |
| **Consequences** | ➕ ใช้งานต่อได้แม้เจ้าหลักล่ม · error ที่รวมแล้วบอกครบทุกเจ้าว่าล้มเพราะอะไร<br>➖ ลำดับจริงอาจต่างจาก priority ที่ตั้งไว้ชั่วคราว (เพราะ sticky) — มี test ยืนยันว่ากลับมาใช้ priority เมื่อ sticky ล้ม |

---

## ADR-008 — Expo Speech เป็น TTS สำรองสุดท้ายเสมอ

| | |
|---|---|
| **Decision** | ลำดับ TTS: **เสียงของ persona → TTS priority → ลำดับลงทะเบียน → Expo Speech** (Expo Speech ถูกต่อท้ายแม้บอสจะปิดไว้) |
| **Status** | ✅ Accepted — Phase 3a/3f |
| **Context** | Cloud TTS ต้องใช้ key + เน็ต และเล่นเสียงล้มได้ (audio focus, ไฟล์เสีย) แต่ผู้ช่วยเสียงที่ "เงียบ" คือประสบการณ์ที่แย่ที่สุด |
| **Rationale** | • Expo Speech ทำงานบนเครื่อง ไม่ต้องใช้ key หรือเน็ต และพูดไทย (`th-TH`) ได้<br>• persona voice ใช้ voiceId / speed / pitch ของ persona · ตัวสำรองใช้เสียง default ของตัวเอง<br>• `speak()` ที่ใหม่กว่า หรือ `stop()` ยกเลิกเสียงที่ยัง synthesize ไม่เสร็จ (`runId`, Q4) |
| **Consequences** | ➕ มีเสียงเสมอแม้ไม่ได้ตั้งค่าอะไร<br>➖ เสียงอาจเปลี่ยนกลางคันเมื่อ cloud TTS ล้ม<br>ℹ️ STT ไม่มีตัวสำรองบนเครื่อง: `ExpoSpeechSTT` ต้องใช้ development build จึงตอบ `unsupported` ใน Phase 3 |

---

## ADR-009 — Navigation ใช้ @react-navigation/native-stack

| | |
|---|---|
| **Decision** | ใช้ `@react-navigation/native` + `native-stack` (v7) สำหรับ Main ↔ Settings stack แทน Expo Router |
| **Status** | ✅ Accepted — Phase 3e (บอสระบุใน spec) |
| **Context** | `AGENTS.md` แนะนำ Expo Router (file-based routing ใน `src/app/`) แต่ spec Phase 3e กำหนด `@react-navigation/native-stack` และแอปมีแค่หน้าหลัก + หน้าตั้งค่า 4 หน้า |
| **Rationale** | • ทำตาม spec ที่ lock ไว้<br>• หน้าน้อย ไม่ต้องใช้ deep link หรือ web routing<br>• เก็บ `src/` เป็น feature module ได้ ไม่ต้องย้ายหน้าจอไปไว้ใน `src/app/` |
| **Consequences** | ➕ ประกาศ route แบบ typed ที่เดียว (`navigation/types.ts`)<br>➖ ขัดกับคำแนะนำใน `AGENTS.md` — ถ้าจะย้ายไป Expo Router ใน Phase ถัดไป ต้องย้ายทั้ง `RootNavigator` |

---

## ADR-010 — ใช้ expo-audio แทน expo-av

| | |
|---|---|
| **Decision** | เล่นเสียงจาก cloud TTS ด้วย **expo-audio** (`createAudioPlayer`) เขียนไฟล์ชั่วคราวด้วย **expo-file-system** (`File`, `Paths.cache`) และขอสิทธิ์ไมค์ด้วย `requestRecordingPermissionsAsync` จาก expo-audio |
| **Status** | ✅ Accepted — Phase 3c (แทนที่ expo-av ใน spec) |
| **Context** | spec Phase 3 ให้ติดตั้ง `expo-av` แต่ expo-av ถูกถอดออกจาก Expo SDK 57 แล้ว |
| **Rationale** | • expo-audio เป็นตัวแทนอย่างเป็นทางการ (ต้องมี `expo-asset` เป็น peer)<br>• API ใหม่ของ expo-file-system (`File` implements `Blob`) ใช้อัปโหลดไฟล์เสียงให้ STT ผ่าน `FormData` ได้ตรง ๆ |
| **Consequences** | ➕ ตรงกับ SDK ปัจจุบัน และได้ config plugin สำหรับข้อความขอสิทธิ์ไมค์ (`app.json`)<br>➖ ตัวอย่างโค้ดเก่าที่ใช้ `Audio.Sound` ของ expo-av ใช้ไม่ได้<br>➖ เปลี่ยนข้อความขอสิทธิ์ต้อง build native ใหม่ |

---

## ADR-011 — Phase 4: Shared Memory + Module System

| | |
|---|---|
| **Decision** | วางราก Phase 4 ด้วยโครงสองชิ้นใน `src/core/`:<br>**1. Shared Memory** — interface `MemoryStore` (save / load / list / remove / clear / sync) เก็บ `MemoryFact` แบบ key → value แยก scope `global` กับ `persona` · `LocalMemoryAdapter` (AsyncStorage, key `atom.memory.v1.<global\|persona.N>.<key>`) **ใช้งานได้แล้ว** · `RemoteMemoryAdapter` และ `SyncQueue.flush()` เป็น **stub** (`Not implemented (Phase 4.5+)`)<br>**2. Module System** — interface `AtomModule` (id, name, enabled, dependencies, `init(ctx)`, `dispose()`) + `ModuleRegistry` ที่ init ตามลำดับ dependency และ dispose ย้อนลำดับ · `src/modules/loader.ts` เป็น stub (ระดับแอป)<br>**Hooks:** `ChatHandler` รับ `memoryStore?` (แนบ facts ต่อท้าย system prompt) · `PCCommandHandler` ส่งต่อให้ module `pc-bridge` เมื่อมี ไม่งั้นตอบ stub เดิม |
| **Status** | 🧱 Accepted — **scaffold** (Q6) · ยังไม่ต่อ UI และยังไม่เปิดใช้ในแอป (Phase 4.5+) |
| **Context** | Phase 4 ต้องการ (ก) ความจำระยะยาวที่ทุก persona และทุก module ใช้ร่วมกันได้ เช่น ชื่อเล่นหรือความชอบของบอส และ (ข) ทางเสียบความสามารถใหม่ (เริ่มจากสั่งงานคอม) โดยไม่ต้องแก้ router หรือ handler ทุกครั้ง ประวัติแชท ([ADR-003](#adr-003--ประวัติแชทแยกต่อ-persona-และเก็บถาวร)) ไม่เหมาะเป็นความจำ เพราะยาว ถูกตัดที่ 500 ข้อความ และแยกต่อ persona เสมอ |
| **Rationale** | • **Interface ก่อน implementation:** ใช้ pattern เดียวกับ provider ใน Phase 3 (interface + adapter) เพื่อให้สลับ local ↔ remote ได้โดยไม่แตะผู้ใช้งาน<br>• **Offline-first:** เขียน local ก่อนเสมอ แล้วค่อยส่งขึ้น remote ผ่าน SyncQueue → แอปใช้ได้แม้ออฟไลน์ และ remote ล่มไม่ทำให้ความจำหาย · conflict policy ที่ร่างไว้คือ last-write-wins ตาม `updatedAt` (ต้องยืนยันใน ADR ใหม่ตอน implement remote)<br>• **Key ต่อ fact:** แก้ fact เดียวเขียน key เดียว และ list ตาม scope ด้วย prefix · key จำกัด `A-Z a-z 0-9 _ -` (ไม่มีจุด) กัน prefix ชนกัน<br>• **อยู่ใน `core/`:** ทั้ง memory และ module ไม่รู้จัก UI หรือ provider (ตาม [ARCHITECTURE §2](ARCHITECTURE.md#2-core-vs-module-pattern)) · module ได้แค่ `ModuleContext` (memory + logger) ไม่ใช่ internals ของ feature<br>• **Dependency order + แยกความล้มเหลว:** module ที่ init ล้ม, dependency หาย/ปิด หรือวนกัน ถูกทำเครื่องหมาย `failed` พร้อมเหตุผล ไม่ลาก module อื่นหรือแอปล้มตาม<br>• **Stub ที่ reject จริง:** remote / flush / loader โยน error ชัดเจน แทนการคืนค่าเปล่า เพื่อไม่ให้ใครเข้าใจผิดว่าข้อมูลถูก sync แล้ว<br>• **Backward compatible:** ไม่ส่ง `memoryStore` = ChatHandler ทำงานเหมือนเดิมทุกไบต์ · ไม่มี `pc-bridge` = ตอบ "Phase 4 ครับ" เหมือนเดิม |
| **Consequences** | ➕ เพิ่ม fact หรือ module ใหม่ได้โดยไม่แก้ router / handler · test ด้วย fake ได้ทุกชั้น (21 tests memory + 21 tests module/hooks)<br>➖ facts ที่แนบเพิ่มขนาด system prompt (จำกัด 20 fact ล่าสุด, ค่าละไม่เกิน 200 ตัวอักษร)<br>➖ ค่าใน fact มาจากผู้ใช้/module แล้วถูกใส่ใน prompt ตรง ๆ — ต้องพิจารณาเรื่อง prompt injection ก่อนเปิดให้ module เขียน memory ได้<br>✅ `loader.ts` ย้ายไประดับแอปแล้ว (`src/modules/loader.ts`) เพราะต้อง import module จาก `features/` — core จึงไม่ผิดทิศทาง dependency<br>✅ 4.5.1: `localMemory` ต่อเข้า ChatHandler ของแอปแล้ว (`features/router/appRouter.ts`) และ `initAll()` ทำงานตอนเปิดแอป (`src/boot.ts`)<br>🔜 **ยังไม่ทำ (Phase 4.5+):** UI จัดการความจำ/เปิดปิด module · RemoteMemoryAdapter · SyncQueue แบบ persist + flush · module `pc-bridge` ตัวจริง |
