/**
 * @file การเชื่อมต่อกับ Mark 55: Server URL · จับคู่ (token) · ทดสอบการเชื่อมต่อ — และเป็นเจ้าของ SyncQueue ของแอป
 *
 * ที่เก็บ:
 * - token → SecureStore `mark55.auth.token` (ห้ามอยู่ใน AsyncStorage)
 * - Server URL → AsyncStorage `mark55.sync.serverUrl` (ค่าเริ่มต้นจาก env `EXPO_PUBLIC_MARK55_URL`)
 * - ชื่อเครื่อง + วันหมดอายุของการจับคู่ → AsyncStorage `mark55.sync.device` (ไว้แสดงในหน้า Sync)
 * - คิว / lastSyncAt / conflict / auto-sync → ดู SyncQueue
 *
 * ยังไม่จับคู่ = ไม่มีอะไรทำงานเบื้องหลัง → Shared Memory แบบเครื่องเดียวทำงานเหมือนเดิมทุกอย่าง
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { ProviderError } from '../http/errors';
import { isNumber, isRecord, isString, parseJSON } from '../types/guards';
import { localMemory } from './LocalMemoryAdapter';
import {
  RemoteMemoryAdapter,
  normalizeServerUrl,
  syncErrorText,
  type HealthResult,
  type RemoteMemoryConfig,
} from './RemoteMemoryAdapter';
import { SyncQueue } from './SyncQueue';
import { ALL_MEMORY_TARGETS } from './types';

export const MARK55_TOKEN_KEY = 'mark55.auth.token';
export const SERVER_URL_KEY = 'mark55.sync.serverUrl';
export const DEVICE_KEY = 'mark55.sync.device';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface PairedDevice {
  deviceName: string;
  /** epoch ms */
  expiresAt: number;
  /** epoch ms (เวลาเครื่อง) */
  pairedAt: number;
}

const isPairedDevice = (v: unknown): v is PairedDevice =>
  isRecord(v) && isString(v.deviceName) && isNumber(v.expiresAt) && isNumber(v.pairedAt);

export interface ConnectionCheck {
  ok: boolean;
  /** epoch ms */
  at: number;
  /** ข้อความไทยสำหรับแสดง */
  message: string;
  version?: string;
}

export interface MemorySyncState {
  started: boolean;
  serverUrl: string;
  device: PairedDevice | null;
  /** ผลของ "ทดสอบการเชื่อมต่อ" ล่าสุด (null = ยังไม่ได้ทดสอบในรอบนี้) */
  lastCheck: ConnectionCheck | null;
}

type KeyValueStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;
type SecretStorage = {
  getItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
};

export interface MemorySyncDeps {
  queue: SyncQueue;
  storage?: KeyValueStorage;
  secure?: SecretStorage;
  createRemote?: (config: RemoteMemoryConfig) => RemoteMemoryAdapter;
  defaultServerUrl?: string;
  deviceName?: string;
  now?: () => number;
}

/** inline ตอน bundle (Expo แทนค่า `process.env.EXPO_PUBLIC_*` ให้) — ว่าง = ให้บอสพิมพ์เอง */
export const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_MARK55_URL ?? '';

export class MemorySync {
  readonly queue: SyncQueue;
  private readonly storage: KeyValueStorage;
  private readonly secure: SecretStorage;
  private readonly createRemote: (config: RemoteMemoryConfig) => RemoteMemoryAdapter;
  private readonly deviceName: string;
  private readonly now: () => number;
  private state: MemorySyncState;
  private readonly listeners = new Set<() => void>();
  private starting: Promise<void> | null = null;

  constructor(deps: MemorySyncDeps) {
    this.queue = deps.queue;
    this.storage = deps.storage ?? AsyncStorage;
    this.secure = deps.secure ?? SecureStore;
    this.createRemote = deps.createRemote ?? ((config) => new RemoteMemoryAdapter(config));
    this.deviceName = deps.deviceName ?? `A.T.O.M. (${Platform.OS})`;
    this.now = deps.now ?? Date.now;
    this.state = { started: false, serverUrl: deps.defaultServerUrl ?? DEFAULT_SERVER_URL, device: null, lastCheck: null };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MemorySyncState => this.state;

  /** โหลดค่าที่บันทึกไว้ · จับคู่ไว้แล้ว → เริ่ม sync (ฟังการเปลี่ยนแปลง + ซิงก์ 1 รอบ) · ไม่ reject */
  start(): Promise<void> {
    return (this.starting ??= this.doStart());
  }

  private async doStart(): Promise<void> {
    try {
      const [url, deviceRaw, token] = await Promise.all([
        this.storage.getItem(SERVER_URL_KEY),
        this.storage.getItem(DEVICE_KEY),
        this.secure.getItemAsync(MARK55_TOKEN_KEY, SECURE_OPTIONS),
        this.queue.restore(),
      ]);
      const serverUrl = url ?? this.state.serverUrl;
      const device = parseJSON(deviceRaw, isPairedDevice);
      this.update({ serverUrl, device });
      if (token && serverUrl) {
        this.queue.setRemote(this.createRemote({ baseUrl: serverUrl, token }));
        void this.queue.flush();
      }
    } catch (e) {
      console.error('[sync] โหลดการตั้งค่า Sync ไม่ได้ — ใช้แบบเครื่องเดียวไปก่อน', e);
    } finally {
      this.update({ started: true });
    }
  }

  get isPaired(): boolean {
    return this.queue.getSnapshot().paired;
  }

  /** ตรวจ + บันทึก Server URL — คืนข้อความ error (ไทย) หรือ null · เปลี่ยนไม่ได้ระหว่างจับคู่ */
  async setServerUrl(input: string): Promise<string | null> {
    if (this.isPaired) return 'ยกเลิกการจับคู่ก่อน แล้วค่อยเปลี่ยน Server URL';
    const result = normalizeServerUrl(input);
    if ('error' in result) return result.error;
    this.update({ serverUrl: result.url, lastCheck: null });
    try {
      await this.storage.setItem(SERVER_URL_KEY, result.url);
    } catch (e) {
      console.error('[sync] บันทึก Server URL ไม่สำเร็จ', e);
      return 'บันทึก Server URL ลงเครื่องไม่สำเร็จ — ใช้ได้ตอนนี้ แต่เปิดแอปใหม่ต้องใส่อีกครั้ง';
    }
    return null;
  }

  /** health() + (ถ้าจับคู่แล้ว) ตรวจว่า token ยังใช้ได้ */
  async testConnection(): Promise<ConnectionCheck> {
    const check = await this.check();
    this.update({ lastCheck: check });
    return check;
  }

  private async check(): Promise<ConnectionCheck> {
    const at = this.now();
    if (!this.state.serverUrl) return { ok: false, at, message: 'ใส่ Server URL ก่อน' };
    const token = this.isPaired ? await this.readToken() : null;
    const remote = this.createRemote({ baseUrl: this.state.serverUrl, ...(token ? { token } : {}) });
    let health: HealthResult;
    try {
      health = await remote.health();
    } catch (e) {
      return { ok: false, at, message: syncErrorText(e) };
    }
    const version = health.version ? ` · Mark 55 v${health.version}` : '';
    if (!token) return { ok: true, at, version: health.version, message: `เชื่อมต่อได้${version} — จับคู่ต่อได้เลย` };
    try {
      const verify = await remote.verify();
      if (!verify.valid) {
        return { ok: false, at, version: health.version, message: 'การจับคู่หมดอายุหรือถูกยกเลิก — กด "ยกเลิก Pair" แล้วจับคู่ใหม่' };
      }
      return { ok: true, at, version: health.version, message: `เชื่อมต่อแล้ว${version}` };
    } catch (e) {
      return { ok: false, at, message: syncErrorText(e) };
    }
  }

  /** แลกรหัส 6 หลักเป็น token → เก็บใน SecureStore → ส่ง fact ทั้งหมดในเครื่องขึ้นไปรอบแรก */
  async pair(pairingCode: string): Promise<PairedDevice> {
    if (!this.state.serverUrl) throw new ProviderError('mark55', 'bad_request', 'ใส่ Server URL ก่อน');
    const remote = this.createRemote({ baseUrl: this.state.serverUrl });
    const { token, expiresAt } = await remote.pair(pairingCode, this.deviceName);
    try {
      await this.secure.setItemAsync(MARK55_TOKEN_KEY, token, SECURE_OPTIONS);
    } catch (e) {
      // ไม่มีที่เก็บ token ปลอดภัย = ไม่จับคู่ (ห้ามตกไปเก็บใน AsyncStorage)
      console.error('[sync] เก็บ token ไม่สำเร็จ', e);
      throw new ProviderError('mark55', 'unsupported', 'เก็บรหัสการจับคู่ในที่ปลอดภัยของเครื่องไม่สำเร็จ — ลองใหม่อีกครั้ง');
    }
    const device: PairedDevice = { deviceName: this.deviceName, expiresAt, pairedAt: this.now() };
    try {
      await this.storage.setItem(DEVICE_KEY, JSON.stringify(device));
    } catch (e) {
      console.error('[sync] บันทึกข้อมูลการจับคู่ไม่สำเร็จ', e);
    }
    await this.queue.reset();
    this.queue.setRemote(remote);
    this.update({ device, lastCheck: { ok: true, at: this.now(), message: 'จับคู่สำเร็จ' } });
    await this.queue.enqueueAll();
    void this.queue.flush();
    return device;
  }

  /** ลืม token + ล้างคิว — fact ในเครื่องไม่ถูกลบ */
  async unpair(): Promise<void> {
    this.queue.setRemote(null);
    await this.queue.reset();
    this.update({ device: null, lastCheck: null });
    try {
      await Promise.all([this.secure.deleteItemAsync(MARK55_TOKEN_KEY, SECURE_OPTIONS), this.storage.removeItem(DEVICE_KEY)]);
    } catch (e) {
      console.error('[sync] ลบข้อมูลการจับคู่ไม่สำเร็จ', e);
    }
  }

  private async readToken(): Promise<string | null> {
    try {
      return await this.secure.getItemAsync(MARK55_TOKEN_KEY, SECURE_OPTIONS);
    } catch (e) {
      console.error('[sync] อ่าน token ไม่ได้', e);
      return null;
    }
  }

  private update(patch: Partial<MemorySyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** ตัวเดียวทั้งแอป — ใช้ Shared Memory ตัวเดียวกับ ChatHandler / แท็บ Memory */
export const memorySync = new MemorySync({
  queue: new SyncQueue({ local: localMemory, targets: ALL_MEMORY_TARGETS }),
});
