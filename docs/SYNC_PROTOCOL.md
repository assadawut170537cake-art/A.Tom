# Sync Protocol — Shared Memory ⇄ Mark 55

> เอกสารอ้างอิงของระบบซิงก์ความจำระหว่างแอป A.T.O.M. กับ **Mark 55** (server บน PC ของบอส, Node + Fastify — Phase 4.5.4.1)
> ฝั่งมือถือ: Phase 4.5.4.2 (implement) · 4.5.4.3 (ตรวจ conflict + เอกสารนี้)
> เหตุผลของการออกแบบ → [ADR-012](DECISIONS.md#adr-012--sync-shared-memory-กับ-mark-55)

## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [ส่วนประกอบในแอป](#2-ส่วนประกอบในแอป)
3. [การจับคู่ (Pairing)](#3-การจับคู่-pairing)
4. [Wire format](#4-wire-format)
5. [Endpoint](#5-endpoint)
6. [รอบการซิงก์ (flush)](#6-รอบการซิงก์-flush)
7. [Conflict resolution — LWW + tombstone](#7-conflict-resolution--lww--tombstone)
8. [Conflict Log](#8-conflict-log)
9. [ความล้มเหลวและการลองใหม่](#9-ความล้มเหลวและการลองใหม่)
10. [ที่เก็บข้อมูล](#10-ที่เก็บข้อมูล)
11. [ความปลอดภัย](#11-ความปลอดภัย)
12. [ข้อตกลงที่ server ต้องทำตาม](#12-ข้อตกลงที่-server-ต้องทำตาม)
13. [การทดสอบ](#13-การทดสอบ)

---

## 1. ภาพรวม

- **Offline-first:** ความจำในเครื่อง (`LocalMemoryAdapter`) คือแหล่งจริงของแอปเสมอ — แชท, แท็บ Memory, Agent อ่าน/เขียนที่นี่
  การซิงก์เป็นงานเบื้องหลังที่ส่งการเปลี่ยนแปลงขึ้น Mark 55 และดึงของเครื่องอื่นลงมา
- **ไม่จับคู่ = ไม่มีอะไรทำงาน:** ไม่ฟังการเปลี่ยนแปลง ไม่มี timer ไม่มีคำขอเครือข่าย → แอปเครื่องเดียวทำงานเหมือนก่อนมี sync ทุกอย่าง
- **ตัวตนของ fact = `target + key`** (เช่น `global.nickname`, `persona.1.joke`) ไม่ใช่ `id` ในเครื่อง เพราะแต่ละเครื่องสร้าง id เอง
- **การลบ = tombstone** (`deleted: true`) เพื่อให้เครื่องอื่นรู้ว่าต้องลบตาม

```
 ┌──────────── มือถือ ─────────────────────────────────────────────┐          ┌──── PC ────┐
 │                                                                  │          │            │
 │  แชท / แท็บ Memory ──save/remove/clear──▶ LocalMemoryAdapter     │          │  Mark 55   │
 │                                              │ subscribe()        │          │  (Fastify) │
 │                                              ▼                    │  HTTP    │            │
 │  ตั้งค่า › Sync ──▶ MemorySync ──owns──▶ SyncQueue ──flush()──────┼─────────▶│ /api/v1/…  │
 │                       │                      ▲  │ applyRemote()   │  JSON    │            │
 │                       │ token (SecureStore)  │  └──────────▶ Local│◀─────────┤            │
 │                       ▼                      │                    │          │            │
 │              RemoteMemoryAdapter ────────────┘                    │          └────────────┘
 │  triggers: เปิดแอปกลับมา · เน็ตกลับมา · ปุ่ม "ซิงก์ตอนนี้" · ทุก 30s  │
 └──────────────────────────────────────────────────────────────────┘
```

## 2. ส่วนประกอบในแอป

| ไฟล์ | หน้าที่ |
|---|---|
| `src/core/memory/LocalMemoryAdapter.ts` | ความจำในเครื่อง · `subscribe()` แจ้งทุก save/remove/clear (ลบ = tombstone) · `applyRemote()` เขียนของจาก server **โดยไม่แจ้ง listener** และคง `updatedAt` ของ server |
| `src/core/memory/RemoteMemoryAdapter.ts` | HTTP client ของ Mark 55 (pair / verify / pull / push / health) · แปลง wire ⇄ `SyncFact` · ข้อความ error ไทย · ไม่ retry |
| `src/core/memory/SyncQueue.ts` | คิวการเปลี่ยนแปลงที่ยังไม่ส่ง · `flush()` · conflict resolution + log · retry/backoff · triggers · persist ทุกครั้งที่เปลี่ยน |
| `src/core/memory/MemorySync.ts` | Server URL · pair / unpair · ทดสอบการเชื่อมต่อ · ตัวเดียวทั้งแอป `memorySync` (boot เรียก `start()`) |
| `src/features/settings/screens/SyncScreen.tsx` | หน้า ตั้งค่า › Sync |

## 3. การจับคู่ (Pairing)

```
บอส                 แอป (MemorySync)                    Mark 55
 │  ใส่ URL + รหัส 6 หลัก │                                    │
 │──────────────────────▶│  POST /api/v1/auth/pair             │
 │                       │  { code, deviceName }  ────────────▶│  ตรวจรหัส (จำกัด 5 ครั้ง/นาที/IP)
 │                       │◀──────────── { token, expiresAt }   │  JWT 30 วัน
 │                       │  SecureStore mark55.auth.token       │
 │                       │  queue.reset() → setRemote()         │
 │                       │  enqueueAll()  (fact ที่มีอยู่ก่อนจับคู่) │
 │                       │  flush() ──────────────────────────▶│
 │◀──── 🟢 จับคู่สำเร็จ ───│                                    │
```

- เก็บ token ใน SecureStore ไม่ได้ → **ไม่จับคู่** (ไม่ตกไปเก็บใน AsyncStorage)
- ยกเลิก Pair → ลบ token + ล้างคิว/lastSyncAt/conflict log · **fact ในเครื่องไม่ถูกลบ**
- เปลี่ยน Server URL ได้เฉพาะตอนยังไม่จับคู่ (token ผูกกับ server)
- token หมดอายุ/ถูกเพิกถอน → server ตอบ 401 → สถานะ 🔴 + "การจับคู่หมดอายุ… จับคู่ใหม่" · ไม่ retry

## 4. Wire format

```jsonc
{
  "target": "global" | { "persona": "1" | "2" | "3" | "4" },
  "key": "nickname",          // A-Z a-z 0-9 _ -  ≤ 64 ตัว (MEMORY_KEY_PATTERN)
  "value": "ต้น",              // tombstone ส่ง ""
  "updatedAt": 1760580000000, // epoch ms ตามนาฬิกาเครื่องที่แก้
  "deleted": true             // มีเฉพาะ tombstone
}
```

ในแอปแปลงเป็น `SyncFact` (`src/core/memory/types.ts`):

| wire | `SyncFact` |
|---|---|
| `"global"` | `{ scope: 'global' }` |
| `{ persona: "1" }` | `{ scope: 'persona', persona: 1 }` (รับเลข number ด้วย) |
| `deleted` ไม่มี | `deleted: false` |
| `updatedAt` เป็น ISO string | แปลงเป็น epoch ms |

fact ที่รูปแบบผิด (target/key/เวลาไม่ถูก, ไม่มี value ทั้งที่ไม่ใช่ tombstone) **ถูกข้ามพร้อม log** — ไม่ทำให้ทั้งรอบล้ม

## 5. Endpoint

prefix `/api/v1` · body/response เป็น JSON · timeout 10 วินาที · ทุกตัวยกเว้น pair/health ใช้ `Authorization: Bearer <token>`

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/auth/pair` | `{ code, deviceName }` | `{ token, expiresAt }` |
| GET | `/auth/verify` | — | `{ valid, deviceName, expiresAt }` · ไม่มี endpoint (404) → แอปใช้ pull เปล่าแทน |
| GET | `/memory/sync?since=<ms>` | — | `{ facts: Wire[], serverTimestamp }` (รับ `syncedAt` แทนได้) |
| POST | `/memory/sync` | `{ version: "atom.memory.v1", lastSyncAt, facts: Wire[] }` | `{ applied, conflicts: [{ target, key, server? }], serverTimestamp }` |
| GET | `/health` | — | `{ status, version, uptime }` |

> ⚠️ ชื่อ field ใน request/response อิงจาก spec 4.5.4.1 (โค้ด server ไม่อยู่ใน repo นี้) — ถ้าไม่ตรง แก้ที่ `RemoteMemoryAdapter.ts` ที่เดียว

## 6. รอบการซิงก์ (flush)

```
flush()  (เรียกซ้อนกันได้ — ได้รอบเดียวกัน)
 │
 ├─ 0. ยังไม่จับคู่ → { skipped: 'unpaired' }
 │
 ├─ 1. PULL  GET /memory/sync?since=lastSyncAt
 │      ได้ facts ที่ server รับหลัง lastSyncAt + serverTimestamp (= T_pull)
 │      แต่ละ fact → applyPulled()  ─────────────────────────── ดูข้อ 7
 │
 ├─ 2. PUSH  POST /memory/sync { facts: คิวที่เหลือ, lastSyncAt: T_pull }
 │      server ไม่รับตัวไหน (conflicts) → applyRejected() ─── ดูข้อ 7
 │
 ├─ 3. dequeue ทุกตัวใน batch ที่ยังเป็นฉบับเดิม
 │      (ตัวที่บอสแก้ซ้ำระหว่างรอ server = id ใหม่ → ยังอยู่ในคิว ส่งรอบหน้า)
 │
 └─ 4. lastSyncAt = T_pull  (หรือ 0 ถ้ามี conflict ที่ server ไม่ส่งฉบับมา → รอบหน้าดึงใหม่ทั้งหมด)
```

**ทำไม `lastSyncAt` = เวลาตอน pull ไม่ใช่ตอน push** (แก้ใน 4.5.4.3): ถ้าเครื่อง B push เข้ามา *ระหว่าง* pull กับ push ของเรา
ฉบับของ B มี `syncedAt` อยู่ในช่วงนั้น ถ้ารอบหน้าเริ่มที่เวลาตอน push จะไม่มีวันได้ของ B เลย
ราคาที่จ่าย: ของที่เราเพิ่ง push วนกลับมาในรอบหน้า แต่ถูกข้าม เพราะค่า + `updatedAt` ตรงกับในเครื่อง

**ทำไมส่ง `lastSyncAt: T_pull` ตอน push:** บอก server ว่า "เราเห็นทุกอย่างถึง T_pull แล้ว" → server แยกได้ว่าฉบับของมันที่เก่ากว่านั้น
ไม่ใช่ conflict (เราแก้ทับโดยรู้อยู่แล้ว) — ถ้าไม่แยก การลบ fact ที่ซิงก์แล้วจะถูก "แก้ชนะลบ" ปัดตกทุกครั้ง (ดูข้อ 12)

### Triggers

| เหตุการณ์ | ที่มา |
|---|---|
| เปิดแอป (จับคู่ไว้แล้ว) | `MemorySync.start()` จาก `boot.ts` |
| แอปกลับมาอยู่หน้าจอ | `AppState` → `active` |
| เน็ตกลับมา | `expo-network` `addNetworkStateListener` (ออฟไลน์ → ออนไลน์) |
| ปุ่ม "ซิงก์ตอนนี้" | หน้า Sync |
| อัตโนมัติ | ทุก 30s เมื่อเปิดสวิตช์ (ค่าเริ่มต้น **ปิด**) |
| ลองใหม่ | backoff หลังล้ม (ข้อ 9) |

## 7. Conflict resolution — LWW + tombstone

### กติกา (`resolveConflict(local, server)`)

ใช้เมื่อ key เดียวกันถูกแก้ทั้งในเครื่องนี้ (ยังค้างในคิว) และที่ server (มาใน pull = ฉบับที่เครื่องนี้ยังไม่เห็น)

| เครื่องนี้ (ค้างในคิว) | server (จาก pull) | ชนะ | หมายเหตุ |
|---|---|---|---|
| แก้ `t=1` | แก้ `t=2` | **server** | ใหม่กว่าชนะ → จด conflict |
| แก้ `t=2` | แก้ `t=1` | **เครื่องนี้** | push ขึ้นไป · ไม่จด |
| แก้ `t=2` | แก้ `t=2` | **เครื่องนี้** | เท่ากัน → ส่งให้ server ตัดสินตอน push |
| ลบ `t=9` | แก้ `t=1` | **server** | **แก้ชนะลบ** แม้การลบใหม่กว่า → จด conflict |
| แก้ `t=1` | ลบ `t=9` | **เครื่องนี้** | **แก้ชนะลบ** → push |
| ลบ | ลบ | ใหม่กว่า | ผลเหมือนกัน → ไม่จด |
| ค่าเดียวกัน | ค่าเดียวกัน | — | ไม่จด |

### fact จาก pull ที่เครื่องนี้ไม่ได้แก้ค้าง

server ถูกเสมอ (เขียนลงเครื่องด้วย `applyRemote()`) ยกเว้น:
- ค่าในเครื่องตรงกับ server อยู่แล้ว (เช่น echo ของที่เราเพิ่ง push) → ข้าม
- tombstone ของ key ที่เครื่องนี้ไม่มี → ข้าม
- ในเครื่องใหม่กว่า server (ไม่ควรเกิด — กันไว้) → ใส่คิวส่งขึ้นไปแทน

### server ไม่รับตอน push (`applyRejected`)

server บอกว่าฉบับของมันชนะ → เขียนฉบับ server ลงเครื่อง + จด conflict
· ถ้าระหว่างรอ บอสแก้ key นั้นอีก (มีฉบับใหม่กว่าในคิว) → ไม่เขียนทับ ให้ฉบับใหม่ส่งรอบหน้า
· ถ้า server ไม่ส่งฉบับของมันมา → `lastSyncAt = 0` รอบหน้าดึงทั้งหมดแล้วลงเอยเหมือนกัน

### ตัวอย่างสองเครื่อง (ทดสอบจริงใน `syncConflict.test.ts`)

```
เวลา  เครื่อง A               Mark 55                    เครื่อง B
 t0   drink=กาแฟ ──push──▶   drink=กาแฟ (s1) ──pull──▶  drink=กาแฟ
      ─── ทั้งคู่ออฟไลน์ ───
 t1                                                     drink=ชาเย็น (แก้)
 t2   ลบ drink
 t3                          ◀──push── drink=ชาเย็น (s2)  ✓ (B เห็น s1 แล้ว → ไม่ขัดแย้ง)
 t4   pull: ได้ ชาเย็น(s2)
      คิว: ลบ(t2) vs แก้(t1) → แก้ชนะลบ → ใช้ ชาเย็น + log
 ผล   drink=ชาเย็น            drink=ชาเย็น               drink=ชาเย็น
```

## 8. Conflict Log

- จดเฉพาะเมื่อ **ฉบับของเครื่องนี้แพ้และค่าต่างกันจริง** (ฝั่งที่ชนะไม่จด)
- แต่ละรายการ: `id` · `target` · `key` · `localValue` (null = ลบ) · `serverValue` (null = ลบ) · `resolvedTo` · `at` (เวลาเครื่อง)
- เก็บ **50 รายการล่าสุด** (ใหม่สุดก่อน) ใน AsyncStorage `mark55.sync.conflicts` · โหลดมาเกิน 50 → ตัดเหลือ 50
- "ล้างประวัติ" → ว่างทั้งในหน่วยความจำและ storage · กดก่อนค่าที่บันทึกไว้โหลดเสร็จก็ไม่ถูกโหลดทับ (`clearConflicts()` รอ `restore()` ก่อน)
- ยกเลิก Pair → ล้าง log ด้วย

## 9. ความล้มเหลวและการลองใหม่

| ProviderError.kind | สาเหตุ | ลองใหม่อัตโนมัติ |
|---|---|---|
| `network` / `timeout` | server ปิด, คนละ Wi-Fi, 10s | ✅ backoff |
| `server` (5xx) / `rate_limit` (429) | server ขัดข้อง / ถี่เกิน | ✅ backoff |
| `invalid_response` | URL ไม่ใช่ Mark 55, เวอร์ชันไม่ตรง | ❌ |
| `auth` (401/403) | token หมดอายุ/ถูกเพิกถอน | ❌ ต้องจับคู่ใหม่ |
| `bad_request` (4xx อื่น) | เช่น clock skew > 1 วัน | ❌ คิวค้างไว้ |

- backoff: 5s → 10s → 20s → … สูงสุด 5 นาที · สำเร็จแล้วรีเซ็ต
- ล้ม → `attempts++` ของทุกรายการในคิว · `lastError` แสดงใน UI (🔴 + ข้อความไทย)
- `flush()` ไม่ reject — ผลอยู่ใน `{ ok, error }`

**Clock skew:** server ปฏิเสธ `updatedAt` ที่ล้ำเวลา server เกิน 1 วัน (400) → การเปลี่ยนแปลงค้างในคิวจนกว่าจะแก้นาฬิกาเครื่อง
(ไม่ retry วน) · ข้อจำกัดที่รู้: แอปยังไม่ปรับ `updatedAt` ตามเวลา server ให้อัตโนมัติ

## 10. ที่เก็บข้อมูล

| ที่ | key | ค่า |
|---|---|---|
| SecureStore | `mark55.auth.token` | JWT (ที่เดียวที่เก็บ token) |
| AsyncStorage | `mark55.sync.serverUrl` | URL ที่จัดรูปแล้ว |
| AsyncStorage | `mark55.sync.device` | `{ deviceName, expiresAt, pairedAt }` |
| AsyncStorage | `mark55.sync.queue` | `SyncQueueItem[]` (key ซ้ำ = แทนของเดิม) |
| AsyncStorage | `mark55.sync.lastSyncAt` | เวลา server ตอน pull ล่าสุดที่สำเร็จ |
| AsyncStorage | `mark55.sync.conflicts` | `ConflictLogEntry[]` ≤ 50 |
| AsyncStorage | `mark55.sync.autoSync` | `boolean` |
| AsyncStorage | `atom.memory.v1.<scope>.<key>` | fact ในเครื่อง (ไม่เปลี่ยน) |

เขียน storage ล้ม → log แล้วใช้ค่าในหน่วยความจำต่อ (ไม่ crash) · ข้อมูลเสีย → ตัดทิ้งพร้อม log

## 11. ความปลอดภัย

- token อยู่ใน SecureStore เท่านั้น · ไม่ log ไม่แสดง
- Server URL: `http://` ได้เฉพาะเครือข่ายในบ้าน (192.168/16 · 10/8 · 172.16/12 · 127/8 · 169.254/16 · localhost · `.local` · `.lan` · Tailscale 100.64/10) · ที่อยู่สาธารณะต้อง `https://`
- error body จาก server ผ่าน `redactSecrets()` (ใน `request()`) ก่อนแสดง
- ค่า fact ที่ดึงมาจาก server เข้า prompt ผ่าน `toPromptLine()` เหมือน fact ที่บอสพิมพ์เอง
- ⚠️ Android release build บล็อก cleartext http — Expo Go / dev build ใช้ได้ · release ต้องเปิด `usesCleartextTraffic` (ต้องเพิ่ม `expo-build-properties` — รออนุมัติ)

## 12. ข้อตกลงที่ server ต้องทำตาม

แอปทำงานถูกเมื่อ Mark 55:

1. **pull** คืนทุกฉบับที่ `syncedAt > since` (รวม tombstone) และ `serverTimestamp` = เวลา server ตอนตอบ
2. **push — แยกขัดแย้งจริงด้วย `lastSyncAt`:** ฉบับบน server ที่ `syncedAt <= lastSyncAt` (client เห็นแล้ว) → รับของใหม่
   ฉบับที่ `syncedAt > lastSyncAt` (client ยังไม่เห็น) → ใช้กติกา **แก้ชนะลบ** แล้ว **`updatedAt` ใหม่กว่าชนะ**
   > ⚠️ ถ้า server ใช้ "แก้ชนะลบ" กับทุกกรณีโดยไม่ดู `lastSyncAt` การลบ fact ที่เคยซิงก์แล้วจะ**ไม่มีวันไปถึงเครื่องอื่น**
   > (พบตอนทดสอบด้วย server จำลองใน 4.5.4.3 — ควรเช็กกับโค้ด Mark 55 จริง)
3. ไม่รับ → ใส่ใน `conflicts` พร้อมฉบับของ server (`server`) — ไม่ส่งมาก็ได้ แต่แอปจะดึงใหม่ทั้งหมดรอบถัดไป
4. เก็บ tombstone ไว้ให้เครื่องที่ยังไม่ได้ซิงก์ (ถ้าจะลบ tombstone เก่า ต้องเก่ากว่าเวลาที่ทุกเครื่องซิงก์ครั้งล่าสุด)

## 13. การทดสอบ

| ไฟล์ | ครอบคลุม |
|---|---|
| `RemoteMemoryAdapter.test.ts` | ทุก endpoint (mock fetch) · 401/429/network/timeout/5xx/400 · wire format · `normalizeServerUrl` |
| `SyncQueue.test.ts` | enqueue/dequeue/persist/restore · flush · conflict · retry/backoff · triggers · auto-sync · `MemorySync` |
| `syncConflict.test.ts` | Conflict Log 50 + ล้าง (รวม race กับ restore) · ตาราง LWW ครบทุกกรณี · **2 เครื่องผ่าน `FakeMark55Server`**: แก้/ลบ/clear ไปถึงอีกเครื่อง, แก้พร้อมกัน, ลบ vs แก้ทั้งสองลำดับ, push แทรกระหว่าง pull–push, ปฏิเสธไม่มีฉบับ, clock skew |
| `SyncScreen.test.tsx` | สถานะ 🟢🟡🔴 · pair flow · ซิงก์ตอนนี้ · auto-sync · conflict log บนจอ |
| `memory.test.ts` | `subscribe()` / `applyRemote()` ของ LocalMemoryAdapter |

`FakeMark55Server` (`src/test-utils/fakeMark55.ts`) ใช้กติกาข้อ 12 — ถ้า server จริงเปลี่ยนกติกา ให้แก้ตัวจำลองตามแล้วรัน test ชุดนี้

### ทดสอบด้วยมือ (Mark 55 จริง)

1. รัน Mark 55 (port 8787) · มือถือกับ PC อยู่ Wi-Fi เดียวกัน
2. ตั้งค่า › Sync → Server URL `http://<PC-IP>:8787` → "ทดสอบการเชื่อมต่อ" → ข้อความเชื่อมต่อได้ (ยัง 🟡)
3. ใส่ pairing code → Pair → 🟢
4. แท็บ Memory เพิ่ม fact → หน้า Sync "รอส่ง" เพิ่ม → "ซิงก์ตอนนี้" → 0
5. **ลบ** fact นั้น → ซิงก์ → server ต้องเก็บเป็น `deleted: true` (ข้อ 12 — ถ้าไม่ลบที่ server = server ยังไม่แยกด้วย `lastSyncAt`)
6. ทดสอบ conflict: เครื่องที่ 2 (หรือยิง POST ตรงที่ server) แก้ key เดียวกันให้ใหม่กว่า → ซิงก์ → เห็นใน "ประวัติ Conflict" → "ล้างประวัติ" → ปิดเปิดแอป → ยังว่าง
