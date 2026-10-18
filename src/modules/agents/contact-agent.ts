/**
 * @file Agent "ติดต่อ" — โทร / ส่ง SMS / เขียนอีเมล หาคนในรายชื่อ
 *
 * | คำสั่ง                                   | ผล                                       |
 * |------------------------------------------|------------------------------------------|
 * | "โทรหาแม่" · "call mom"                  | เปิดแอปโทรศัพท์พร้อมเบอร์ (บอสกดโทรเอง)     |
 * | "ส่งข้อความหาแม่ว่า กลับดึก"               | เปิดแอปข้อความพร้อมข้อความ (บอสกดส่งเอง)    |
 * | "ส่งอีเมลหาพี่บี ว่า ส่งงานแล้ว"            | เปิดแอปอีเมลพร้อมหัวเรื่อง/เนื้อหา            |
 *
 * ไม่โทร/ส่งเองโดยอัตโนมัติ — แค่เปิดแอปของเครื่องให้ตรวจก่อน (ถ้าฟังชื่อผิดจะได้ไม่โทรผิดคน)
 * ชื่อซ้ำหลายคน → บอกรายชื่อให้เลือกพิมพ์ใหม่ (เว้นตรงตัวพอดี)
 */

import * as Contacts from 'expo-contacts/legacy';
import { Linking } from 'react-native';

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';

export const CONTACT_AGENT_ID = 'contact';

export interface ContactMatch {
  name: string;
  phones: string[];
  emails: string[];
}

export interface ContactService {
  /** throw (ข้อความไทย) เมื่อไม่ได้สิทธิ์ */
  search(name: string): Promise<ContactMatch[]>;
  open(url: string): Promise<void>;
}

const NO_PERMISSION = 'ยังไม่ได้อนุญาตให้เข้าถึงรายชื่อ — เปิดได้ที่ ตั้งค่าเครื่อง › แอป › A.T.O.M. › สิทธิ์';

export const deviceContacts: ContactService = {
  async search(name) {
    const current = await Contacts.getPermissionsAsync();
    if (!current.granted && !(await Contacts.requestPermissionsAsync()).granted) throw new Error(NO_PERMISSION);
    const { data } = await Contacts.getContactsAsync({
      name,
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      pageSize: 20,
    });
    return data.map((c) => ({
      name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' '),
      phones: (c.phoneNumbers ?? []).map((p) => p.number ?? p.digits ?? '').filter(Boolean),
      emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
    }));
  },
  async open(url) {
    await Linking.openURL(url);
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** คำนำหน้าที่คนเรียกแต่ไม่ได้บันทึกไว้ในชื่อ */
const HONORIFIC = /^(?:คุณ|พี่|น้อง|ท่าน|อาจารย์|อ\.)\s*/;

/** "แม่ ว่า กลับดึก" → { who: 'แม่', body: 'กลับดึก' } */
export function splitRecipient(command: string): { who: string; body: string } {
  const m = /^(.+?)\s*(?:ว่า|:)\s*([\s\S]*)$/.exec(command.trim());
  if (!m) return { who: command.trim(), body: '' };
  return { who: (m[1] ?? '').trim(), body: (m[2] ?? '').trim() };
}

/** ตัวที่ตรงที่สุด — ชื่อตรงตัว > มีตัวเดียว · ไม่แน่ใจ = null (ให้บอสเลือก) */
export function pickContact(who: string, matches: ContactMatch[]): ContactMatch | null {
  const target = who.toLowerCase();
  const exact = matches.filter((c) => c.name.toLowerCase() === target);
  if (exact.length === 1) return exact[0] ?? null;
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '');

export function createContactAgent(service: ContactService = deviceContacts): AgentDefinition {
  async function find(
    who: string,
    need: 'phones' | 'emails'
  ): Promise<{ contact: ContactMatch; value: string } | { reply: string }> {
    if (!who) return { reply: 'จะติดต่อใครครับ — ลองพิมพ์ "โทรหาแม่"' };
    let matches = await service.search(who);
    const bare = who.replace(HONORIFIC, '');
    if (!matches.length && bare !== who && bare) matches = await service.search(bare);
    const usable = matches.filter((c) => c[need].length);
    if (!usable.length) {
      return {
        reply: matches.length
          ? `“${matches[0]?.name ?? who}” ไม่มี${need === 'phones' ? 'เบอร์โทร' : 'อีเมล'}ในรายชื่อครับ`
          : `ไม่พบ “${who}” ในรายชื่อครับ`,
      };
    }
    const contact = pickContact(who, usable) ?? pickContact(bare, usable);
    if (!contact) {
      const names = usable.slice(0, 4).map((c) => `• ${c.name}`).join('\n');
      return { reply: `เจอหลายคนครับ — พิมพ์ชื่อให้ชัดกว่านี้หน่อย\n${names}` };
    }
    return { contact, value: contact[need][0] ?? '' };
  }

  return {
    id: CONTACT_AGENT_ID,
    name: 'ติดต่อ',
    description: 'โทร ส่งข้อความ หรือเขียนอีเมลหาคนในรายชื่อ',
    capabilities: [
      {
        id: 'contact.call',
        label: 'โทรหา',
        patterns: [/^(?:ช่วย)?โทร(?:ไป)?(?:หา|ถึง)\s*(?<command>.+)$/, /^(?:call|phone)\s+(?<command>.+)$/i],
        examples: ['โทรหาแม่', 'call mom'],
      },
      {
        id: 'contact.sms',
        label: 'ส่งข้อความ',
        patterns: [/^(?:ช่วย)?ส่ง(?:ข้อความ|sms|เอสเอ็มเอส)(?:ไป)?(?:หา|ถึง)\s*(?<command>[\s\S]+)$/i],
        examples: ['ส่งข้อความหาแม่ว่า กลับดึกนะ'],
      },
      {
        id: 'contact.email',
        label: 'เขียนอีเมล',
        patterns: [
          /^(?:ช่วย)?(?:ส่ง|เขียน)(?:อี)?(?:เมล์?|mail)(?:ไป)?(?:หา|ถึง)\s*(?<command>[\s\S]+)$/i,
          /^(?:send\s+)?(?:an\s+)?email\s+to\s+(?<command>[\s\S]+)$/i,
        ],
        examples: ['ส่งอีเมลหาพี่บี ว่า ส่งงานแล้วครับ'],
      },
    ],

    async run({ commandText, capabilityId }) {
      const { who, body } = splitRecipient(commandText);

      if (capabilityId === 'contact.email') {
        let to: string;
        let name: string;
        if (EMAIL.test(who)) {
          to = who;
          name = who;
        } else {
          const found = await find(who, 'emails');
          if ('reply' in found) return found;
          to = found.value;
          name = found.contact.name;
        }
        const subject = body.split('\n')[0]?.slice(0, 60) ?? '';
        await service.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
        return { reply: `เปิดอีเมลถึง ${name} ให้แล้วครับ — ตรวจแล้วกดส่งได้เลย` };
      }

      const found = await find(who, 'phones');
      if ('reply' in found) return found;
      const phone = cleanPhone(found.value);
      if (capabilityId === 'contact.sms') {
        await service.open(`sms:${phone}${body ? `?body=${encodeURIComponent(body)}` : ''}`);
        return { reply: `เปิดข้อความถึง ${found.contact.name} ให้แล้วครับ — กดส่งได้เลย` };
      }
      await service.open(`tel:${phone}`);
      return { reply: `กำลังโทรหา ${found.contact.name} (${found.value}) — กดโทรได้เลยครับ` };
    },
  };
}

export function registerContactAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(CONTACT_AGENT_ID)) registry.register(createContactAgent());
}
