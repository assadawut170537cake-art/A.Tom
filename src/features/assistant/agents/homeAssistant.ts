/**
 * @file Home Assistant — สั่ง/ถามสถานะอุปกรณ์ในบ้านผ่าน REST API ของ Home Assistant (ไม่เขียนโปรโตคอลอุปกรณ์เอง)
 * ตั้งค่า: Home Assistant URL (เช่น http://192.168.1.10:8123) + Long-Lived Access Token (SecureStore)
 *
 * **ความปลอดภัย:** allow-list ทั้งโดเมนและบริการ — สั่งได้เฉพาะไฟ/สวิตช์/พัดลม/ม่าน/ฉาก/มีเดีย/แอร์ (เปิด-ปิด)
 * ไม่แตะประตูล็อก, สัญญาณกันขโมย, garage ฯลฯ · LLM เลือกได้แค่ entity ที่อยู่ในรายการที่เราส่งให้เท่านั้น
 */

import type { AgentDefinition } from '../../../core/agents/types';
import { request } from '../../../core/http/request';
import { ProviderSettings } from '../../../core/storage/ProviderSettings';
import { SecureKeyStore, secretKey } from '../../../core/storage/SecureKeyStore';
import { isRecord } from '../../../core/types/guards';
import { AssistantError } from '../shared/errors';
import { appLlm, extractJson, str, type Llm } from '../shared/llm';

export const HOME_AGENT_ID = 'home-assistant';
export const HA_TOKEN_KEY = secretKey('ai', 'homeassistant');

/** โดเมน → บริการที่อนุญาต */
export const ALLOWED_SERVICES: Readonly<Record<string, readonly string[]>> = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle'],
  cover: ['open_cover', 'close_cover', 'stop_cover'],
  scene: ['turn_on'],
  script: ['turn_on'],
  media_player: [
    'turn_on',
    'turn_off',
    'media_play',
    'media_pause',
    'media_next_track',
    'volume_up',
    'volume_down',
  ],
  climate: ['turn_on', 'turn_off'],
};

export interface HaEntity {
  entityId: string;
  name: string;
  state: string;
}

export interface HaClient {
  states(): Promise<HaEntity[]>;
  callService(domain: string, service: string, entityId: string): Promise<void>;
}

export interface HaConfig {
  url: string;
  token: string;
}

export async function loadHaConfig(): Promise<HaConfig | null> {
  const url = (await ProviderSettings.getOption('homeassistant', 'url'))
    ?.trim()
    .replace(/\/+$/, '');
  const token = await SecureKeyStore.get(HA_TOKEN_KEY);
  return url && token ? { url, token } : null;
}

export function createHaClient(config: HaConfig): HaClient {
  const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
  return {
    async states() {
      const res = await request('home-assistant', `${config.url}/api/states`, {
        headers,
        timeoutMs: 15_000,
      });
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return [];
      return data.flatMap((s) => {
        if (!isRecord(s) || typeof s.entity_id !== 'string' || typeof s.state !== 'string')
          return [];
        const attrs = isRecord(s.attributes) ? s.attributes : {};
        const name = typeof attrs.friendly_name === 'string' ? attrs.friendly_name : s.entity_id;
        return [{ entityId: s.entity_id, name, state: s.state }];
      });
    },
    async callService(domain, service, entityId) {
      await request('home-assistant', `${config.url}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entity_id: entityId }),
        timeoutMs: 15_000,
      });
    },
  };
}

const domainOf = (entityId: string) => entityId.split('.')[0] ?? '';

/** entity ที่ควบคุม/ถามได้ (อยู่ใน allow-list โดเมน) */
export function controllable(entities: HaEntity[]): HaEntity[] {
  return entities.filter((e) => domainOf(e.entityId) in ALLOWED_SERVICES);
}

/** จัดอันดับ entity ตามคำที่ซ้อนกับคำสั่ง แล้วตัดเหลือ `limit` (กัน prompt ยาวเมื่อบ้านมีอุปกรณ์เป็นร้อย) */
export function rankEntities(entities: HaEntity[], command: string, limit = 40): HaEntity[] {
  const words = command
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const score = (e: HaEntity) => {
    const hay = `${e.name} ${e.entityId}`.toLowerCase();
    return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
  };
  return [...entities].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

const STATE_TH: Record<string, string> = {
  on: 'เปิดอยู่',
  off: 'ปิดอยู่',
  open: 'เปิดอยู่',
  closed: 'ปิดอยู่',
  playing: 'กำลังเล่น',
  paused: 'หยุดชั่วคราว',
  unavailable: 'ออฟไลน์',
};

export interface HomeDeps {
  client?: () => Promise<HaClient | null>;
  llm?: Llm;
}

export function createHomeAgent(deps: HomeDeps = {}): AgentDefinition {
  const getClient =
    deps.client ??
    (async () => {
      const config = await loadHaConfig();
      return config ? createHaClient(config) : null;
    });
  const llm = deps.llm ?? appLlm;

  return {
    id: HOME_AGENT_ID,
    name: 'บ้านอัจฉริยะ',
    description: 'สั่งและเช็กสถานะอุปกรณ์ในบ้านผ่าน Home Assistant',
    capabilities: [
      {
        id: 'home.control',
        label: 'สั่งอุปกรณ์ในบ้าน',
        patterns: [
          /^(?:ช่วย)?(?:เปิด|ปิด)(?!ไฟฉาย)(?:ไฟ|พัดลม|แอร์|ทีวี|ม่าน|ปลั๊ก|เครื่องฟอก|เครื่องทำน้ำอุ่น|หลอดไฟ|สวิตช์)(?<command>.*)$/,
          /^(?<command>(?:ตั้งฉาก|เปิดฉาก|รันฉาก|เล่นฉาก).+)$/,
          /^(?<command>(?:ไฟ|พัดลม|แอร์|ทีวี|ม่าน).{0,25}(?:เปิดอยู่|ปิดอยู่|เปิดหรือปิด|เปิดไหม|ปิดไหม).*)$/,
        ],
        examples: ['เปิดไฟห้องนั่งเล่น', 'ปิดพัดลม', 'ไฟห้องนอนเปิดอยู่ไหม'],
      },
    ],
    async run({ text }) {
      const client = await getClient();
      if (!client) {
        return {
          reply:
            'ยังไม่ได้ตั้งค่า Home Assistant ครับ — ใส่ URL กับ Access Token ที่ ตั้งค่า › ผู้ช่วยส่วนตัว',
        };
      }
      const entities = controllable(await client.states());
      if (entities.length === 0) return { reply: 'ไม่พบอุปกรณ์ที่สั่งได้ใน Home Assistant ครับ' };
      const candidates = rankEntities(entities, text);
      const list = candidates.map((e) => `${e.entityId} | ${e.name} | ${e.state}`).join('\n');

      const decision = await extractJson(
        llm,
        `เลือกอุปกรณ์และการกระทำตามคำสั่ง จากรายการ (entity_id | ชื่อ | สถานะ):\n${list}\n` +
          'ห้ามเลือก entity นอกรายการ ถ้าไม่มีอุปกรณ์ที่ตรง ให้ entity_id เป็น null',
        '{"action":"control หรือ query","entity_id":"id หรือ null","service":"turn_on|turn_off|toggle|open_cover|close_cover|... หรือ null"}',
        text,
        (v) => {
          const action = v.action === 'query' ? 'query' : v.action === 'control' ? 'control' : null;
          return action ? { action, entityId: str(v.entity_id), service: str(v.service) } : null;
        },
      );

      const entity = candidates.find((e) => e.entityId === decision.entityId);
      if (!entity)
        return {
          reply:
            'ไม่พบอุปกรณ์ที่ตรงกับคำสั่งครับ — ลองเรียกชื่อให้ตรงกับที่ตั้งไว้ใน Home Assistant',
        };

      if (decision.action === 'query') {
        return {
          reply: `${entity.name}${STATE_TH[entity.state] ? ` ${STATE_TH[entity.state]}` : ` สถานะ ${entity.state}`}ครับ`,
        };
      }
      const domain = domainOf(entity.entityId);
      const service = decision.service;
      if (!service || !ALLOWED_SERVICES[domain]?.includes(service)) {
        throw new AssistantError(
          `สั่ง “${service ?? '?'}” กับ ${entity.name} ไม่ได้ (อนุญาตเฉพาะเปิด/ปิดและคำสั่งพื้นฐาน)`,
        );
      }
      await client.callService(domain, service, entity.entityId);
      const verb =
        service === 'turn_off' || service === 'close_cover'
          ? 'ปิด'
          : service === 'toggle'
            ? 'สลับ'
            : 'เปิด';
      return { reply: `${verb} ${entity.name} ให้แล้วครับ` };
    },
  };
}
