/**
 * @file รายชื่อ + โทรออก + ร่างข้อความ
 *
 * **ความปลอดภัย:** ไม่โทร/ไม่ส่งเองโดยพลการ — เปิดหน้าโทร (`tel:`) หรือหน้าร่างข้อความ (`sms:`) ให้พร้อม แล้วบอสกดเอง
 * ชื่อซ้ำหลายคน = ถามกลับ ไม่เดา · ไม่ log เบอร์โทร
 */

import { Linking } from 'react-native';

import type { AgentDefinition } from '../../../core/agents/types';
import { AssistantError, loadNative } from '../shared/errors';

export const CONTACTS_AGENT_ID = 'contacts';

export interface ContactHit {
  name: string;
  phones: { label?: string; number: string }[];
}

export interface ContactsApi {
  /** ค้นด้วยชื่อ (บางส่วน) — null = ไม่ได้สิทธิ์ */
  find(name: string): Promise<ContactHit[] | null>;
  open(url: string): Promise<void>;
}

function defaultApi(): ContactsApi {
  return {
    async find(name) {
      const Contacts = loadNative(
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
        () => require('expo-contacts/legacy') as typeof import('expo-contacts/legacy'),
        'รายชื่อ',
      );
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) return null;
      const { data } = await Contacts.getContactsAsync({
        name,
        fields: [Contacts.Fields.PhoneNumbers],
        pageSize: 20,
      });
      return data.map((c) => ({
        name: c.name ?? '',
        phones: (c.phoneNumbers ?? []).flatMap((p) =>
          p.number ? [{ ...(p.label ? { label: p.label } : {}), number: p.number }] : [],
        ),
      }));
    },
    open: async (url) => {
      await Linking.openURL(url);
    },
  };
}

/** เบอร์ที่ควรใช้: ป้ายมือถือก่อน ไม่มีก็ตัวแรก */
export function pickNumber(hit: ContactHit): string | null {
  const mobile = hit.phones.find((p) => /mobile|cell|มือถือ|iphone/i.test(p.label ?? ''));
  return (mobile ?? hit.phones[0])?.number.replace(/[^\d+*#]/g, '') ?? null;
}

type Resolved = { ok: true; name: string; number: string } | { ok: false; reply: string };

async function resolve(api: ContactsApi, query: string): Promise<Resolved> {
  const name = query.trim();
  if (!name) return { ok: false, reply: 'ต้องการติดต่อใครครับ?' };
  const hits = await api.find(name);
  if (hits === null)
    return {
      ok: false,
      reply: 'ยังไม่ได้อนุญาตให้เข้าถึงรายชื่อ — เปิดสิทธิ์ในตั้งค่าเครื่องก่อนครับ',
    };
  const withPhone = hits.filter((h) => pickNumber(h));
  if (withPhone.length === 0) {
    return {
      ok: false,
      reply: hits.length
        ? `“${hits[0]?.name}” ยังไม่มีเบอร์โทรในรายชื่อครับ`
        : `ไม่พบ “${name}” ในรายชื่อครับ`,
    };
  }
  const exact = withPhone.filter((h) => h.name.trim().toLowerCase() === name.toLowerCase());
  const candidates = exact.length ? exact : withPhone;
  if (candidates.length > 1) {
    const names = candidates
      .slice(0, 3)
      .map((c) => c.name)
      .join(' หรือ ');
    return {
      ok: false,
      reply: `มีหลายคนที่ตรงกับ “${name}” ครับ: ${names} — บอกชื่อให้ชัดขึ้นหน่อย`,
    };
  }
  const only = candidates[0] as ContactHit;
  return { ok: true, name: only.name, number: pickNumber(only) as string };
}

/** "แม่ ว่า ถึงบ้านแล้ว" → { name: "แม่", body: "ถึงบ้านแล้ว" } */
export function splitSms(command: string): { name: string; body: string } {
  const m = command.match(/^(?<name>.+?)\s*(?:ว่า|:|แจ้งว่า|บอกว่า)\s*(?<body>[\s\S]+)$/);
  return m?.groups
    ? { name: m.groups.name!.trim(), body: m.groups.body!.trim() }
    : { name: command.trim(), body: '' };
}

export function createContactsAgent(api: ContactsApi = defaultApi()): AgentDefinition {
  return {
    id: CONTACTS_AGENT_ID,
    name: 'รายชื่อ',
    description: 'หาเบอร์ในรายชื่อ เปิดหน้าโทร และร่างข้อความ (บอสกดส่งเอง)',
    capabilities: [
      {
        id: 'contact.call',
        label: 'โทรหา',
        patterns: [
          /^(?:ช่วย)?(?:โทรศัพท์หา|โทร(?!ศัพท์|ทัศน์)(?:หา|ไปหา|ไป)?|call)\s*(?<command>.{1,30})$/i,
        ],
        examples: ['โทรหาแม่', 'โทรหา สมชาย'],
      },
      {
        id: 'contact.sms',
        label: 'ร่างข้อความ',
        patterns: [/^(?:ช่วย)?ส่ง(?:ข้อความ|เอสเอ็มเอส|sms)(?:ไป)?หา\s*(?<command>.+)$/i],
        examples: ['ส่งข้อความหาแม่ ว่า ถึงบ้านแล้ว'],
      },
      {
        id: 'contact.lookup',
        label: 'ดูเบอร์',
        patterns: [/^เบอร์(?:โทร)?(?:ของ)?\s*(?<command>\S.{0,40})$/],
        examples: ['เบอร์แม่'],
      },
    ],
    async run({ commandText, capabilityId }) {
      if (capabilityId === 'contact.sms') {
        const { name, body } = splitSms(commandText);
        const r = await resolve(api, name);
        if (!r.ok) return { reply: r.reply };
        const url = `sms:${r.number}${body ? `?body=${encodeURIComponent(body)}` : ''}`;
        await api.open(url);
        return { reply: `เปิดหน้าร่างข้อความถึง ${r.name} ให้แล้วครับ กดส่งเองได้เลย` };
      }
      const r = await resolve(api, commandText);
      if (!r.ok) return { reply: r.reply };
      if (capabilityId === 'contact.lookup') {
        const spoken = r.number.replace(/(\d)/g, '$1 ').trim();
        return { reply: `เบอร์ของ ${r.name} คือ ${spoken}` };
      }
      await api.open(`tel:${r.number}`);
      return { reply: `เปิดหน้าโทรหา ${r.name} ให้แล้วครับ กดโทรได้เลย` };
    },
  };
}

export { AssistantError };
