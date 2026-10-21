/**
 * @file ดึง API key ของบอสจาก Supermemory มาใส่ SecureStore ตอนเปิดแอป — ไม่ต้องกรอกใหม่ทุกครั้งที่ build (Boss ขอ)
 *
 * ทำไมปลอดภัย: คีย์ไหลจาก Supermemory → SecureStore เท่านั้น **ไม่** ถูกแนบเข้า prompt (คนละทางกับ memory fact
 * ที่ ChatHandler แนบ — ตัวนั้นมาจาก localMemory) · ไม่ commit คีย์ลง git · เก็บใน space แยก (ไม่ใช่ core ที่ sync ขึ้น prompt)
 *
 * บอสเก็บคีย์ใน Supermemory space `SECRETS_CONTAINER_TAG` โดยเนื้อหาแต่ละบรรทัดเป็น `<ชื่อคีย์> = <ค่า>` เช่น
 *   ai.gemini = AIza...            (คีย์ Gemini — ตรงกับ secretKey('ai','gemini'))
 *   tts.elevenlabs = ...           (ตรงกับ secretKey('tts','elevenlabs'))
 *   stt.openai = ...
 * ชื่อคีย์ = ชื่อใน SecureKeyStore (ดู secretKey()) · รับเฉพาะ prefix ที่อนุญาต (กันเขียนคีย์มั่วจากเน็ต)
 *
 * ⚠️ ชื่อ endpoint / รูปแบบ response ของ Supermemory อิง OpenAPI v3 (`POST /v3/documents/list`) (ไม่มีโค้ด server ในนี้) — ถ้า Supermemory
 * เปลี่ยน แก้ที่ `search()` / `parseDocuments()` ในไฟล์นี้ที่เดียว
 */

import { redactSecrets } from '../http/errors';
import { request } from '../http/request';
import { SecureKeyStore, type KeyStore } from '../storage/SecureKeyStore';
import { isArray, isRecord, isString } from '../types/guards';

/** list ไม่ใช่ search — `/v3/search` ไม่รับคำค้นว่าง (400 "Search query cannot be empty") และค้นแบบ semantic อาจตกหล่น */
export const SECRETS_SEARCH_ENDPOINT = 'https://api.supermemory.ai/v3/documents/list';
/** space แยกสำหรับคีย์ — ไม่ใช่ core (ที่ sync ขึ้น prompt) */
export const SECRETS_CONTAINER_TAG = 'project_atom_memory_base_4folders_atom_secrets';
/** ชื่อคีย์ Supermemory เองใน SecureKeyStore (ใช้ดึง bootstrap) */
export const SUPERMEMORY_KEY_NAME = 'supermemory.apiKey';
export const SECRETS_TIMEOUT_MS = 10_000;
/** รับเฉพาะคีย์ provider — กันเขียน token การจับคู่ (mark55.auth) หรือคีย์ Supermemory เองทับจากเน็ต */
export const ALLOWED_KEY_PREFIXES = ['ai.', 'tts.', 'stt.', 'mcp.', 'pcbridge.'] as const;
/** ชื่อคีย์ตามที่ SecureStore ยอม (ตรงกับ SecureKeyStore.VALID_KEY) */
const KEY_NAME = /^[A-Za-z0-9._-]+$/;

export interface ParsedSecret {
  name: string;
  value: string;
}

/** แยกบรรทัด `name = value` / `name: value` จากเนื้อหา document · ข้ามบรรทัดที่ไม่เข้ารูปหรือคีย์ไม่ได้รับอนุญาต */
export function parseSecretLines(content: string): ParsedSecret[] {
  const out: ParsedSecret[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z0-9._-]+)\s*[=:]\s*(.+)$/.exec(line);
    if (!match) continue;
    const name = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    if (!value || !KEY_NAME.test(name)) continue;
    if (!ALLOWED_KEY_PREFIXES.some((p) => name.startsWith(p))) continue;
    out.push({ name, value });
  }
  return out;
}

type Fetcher = typeof request;

export interface SecretSyncDeps {
  keyStore?: Pick<KeyStore, 'get' | 'set' | 'has'> | undefined;
  fetcher?: Fetcher | undefined;
  timeoutMs?: number | undefined;
  endpoint?: string | undefined;
  containerTag?: string | undefined;
}

export interface SecretImportResult {
  /** จำนวนคีย์ที่เขียนลง SecureStore รอบนี้ */
  imported: number;
  /** พบใน Supermemory แต่มีอยู่แล้วในเครื่อง (ไม่ทับ) */
  skipped: number;
  /** ไม่มีคีย์ Supermemory = ไม่ได้ทำอะไร */
  reason?: 'no_supermemory_key' | 'error';
}

export class SecretSync {
  private readonly keyStore: Pick<KeyStore, 'get' | 'set' | 'has'>;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly endpoint: string;
  private readonly containerTag: string;

  constructor(deps: SecretSyncDeps = {}) {
    this.keyStore = deps.keyStore ?? SecureKeyStore;
    this.fetcher = deps.fetcher ?? request;
    this.timeoutMs = deps.timeoutMs ?? SECRETS_TIMEOUT_MS;
    this.endpoint = deps.endpoint ?? SECRETS_SEARCH_ENDPOINT;
    this.containerTag = deps.containerTag ?? SECRETS_CONTAINER_TAG;
  }

  /**
   * ดึงคีย์จาก Supermemory → SecureStore หนึ่งรอบ · fail-open (ไม่ throw)
   * `overwrite` = true → ทับของเดิม (ค่าเริ่มต้นเติมเฉพาะคีย์ที่ยังไม่มี กันเขียนทับที่บอสเพิ่งตั้งในเครื่อง)
   */
  async importOnce(overwrite = false): Promise<SecretImportResult> {
    const apiKey = (await this.safeGet(SUPERMEMORY_KEY_NAME))?.trim();
    if (!apiKey) return { imported: 0, skipped: 0, reason: 'no_supermemory_key' };
    let secrets: ParsedSecret[];
    try {
      secrets = await this.search(apiKey);
    } catch (e) {
      console.error(
        '[secrets] ดึงคีย์จาก Supermemory ไม่สำเร็จ — ใส่เองที่ ตั้งค่า › AI/เสียง ได้ตามปกติ',
        redactSecrets(errText(e)),
      );
      return { imported: 0, skipped: 0, reason: 'error' };
    }
    // คีย์ชื่อซ้ำใน Supermemory → ใช้ตัวหลังสุด
    const latest = new Map(secrets.map((s) => [s.name, s.value]));
    let imported = 0;
    let skipped = 0;
    for (const [name, value] of latest) {
      try {
        if (!overwrite && (await this.keyStore.has(name))) {
          skipped++;
          continue;
        }
        await this.keyStore.set(name, value);
        imported++;
      } catch (e) {
        console.error(
          `[secrets] เขียนคีย์ "${name}" ลงเครื่องไม่สำเร็จ`,
          redactSecrets(errText(e)),
        );
      }
    }
    return { imported, skipped };
  }

  private async search(apiKey: string): Promise<ParsedSecret[]> {
    const res = await this.fetcher('supermemory', this.endpoint, {
      method: 'POST',
      timeoutMs: this.timeoutMs,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // ทุก document ใน space คีย์ + เนื้อหา (ค่าเริ่มต้น list ไม่ส่ง content มา) · limit พอสำหรับคีย์หลายสิบตัว
      body: JSON.stringify({ containerTags: [this.containerTag], includeContent: true, limit: 100 }),
    });
    const body: unknown = await res.json();
    return parseDocuments(body).flatMap(parseSecretLines);
  }

  private async safeGet(name: string): Promise<string | null> {
    try {
      return await this.keyStore.get(name);
    } catch (e) {
      console.error('[secrets] อ่านคีย์ Supermemory ไม่ได้', redactSecrets(errText(e)));
      return null;
    }
  }
}

/** ดึงข้อความของแต่ละ document จาก response ของ Supermemory (รองรับหลายรูปแบบ field ที่เจอได้) */
export function parseDocuments(body: unknown): string[] {
  if (!isRecord(body)) return [];
  // documents/list คืน `memories` · search คืน `results` · เผื่อ `documents`
  const results = isArray(body.memories)
    ? body.memories
    : isArray(body.results)
      ? body.results
      : isArray(body.documents)
        ? body.documents
        : [];
  return results.flatMap((item): string[] => {
    if (!isRecord(item)) return [];
    if (isString(item.content) && item.content) return [item.content];
    if (isString(item.memory) && item.memory) return [item.memory];
    if (isString(item.text) && item.text) return [item.text];
    // บางรูปแบบคืนเป็น chunks[].content
    if (isArray(item.chunks)) {
      const text = item.chunks
        .flatMap((c) => (isRecord(c) && isString(c.content) ? [c.content] : []))
        .join('\n');
      return text ? [text] : [];
    }
    return [];
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** ตัวเดียวทั้งแอป — boot เรียก `importOnce()` */
export const secretSync = new SecretSync();
