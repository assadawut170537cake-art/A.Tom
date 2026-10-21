/**
 * @file เตือนตามเวลา + สรุปเช้ารายวัน (แจ้งเตือนเชิงรุก) — ใช้แจ้งเตือนในเครื่อง ไม่ต้องมีเซิร์ฟเวอร์ push
 * "เตือนให้โทรหาหมอพรุ่งนี้ 9 โมง" · "เปิดสรุปเช้า 7 โมง" → ทุกเช้ามีแจ้งเตือน แตะแล้วผู้ช่วยสรุปนัด+อากาศให้
 */

import { agentRegistry } from '../../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../../core/agents/types';
import { defaultNotificationsApi, type NotificationsApi } from '../notifications';
import { AssistantError } from '../shared/errors';
import { appLlm, extractJson, str, type Llm } from '../shared/llm';
import { parseDate, speakDate } from '../shared/time';
import { parseClock } from './clock';

export const REMINDER_AGENT_ID = 'reminder';
export const BRIEFING_TITLE = 'สรุปเช้าจากผู้ช่วย';
const pad = (n: number) => String(n).padStart(2, '0');

/** สรุปวันนี้ = นัดหมาย + อากาศ (เรียก agent อื่นผ่าน registry — ตัวไหนล้มก็ข้าม) */
export async function composeBriefing(): Promise<string> {
  const sources: [string, string, string][] = [
    ['calendar', 'calendar.agenda', 'ดูตารางนัดวันนี้'],
    ['place', 'place.weather', 'วันนี้อากาศเป็นไง'],
  ];
  const parts: string[] = [];
  for (const [agentId, capabilityId, text] of sources) {
    if (!agentRegistry.has(agentId)) continue;
    try {
      const result = await agentRegistry.run(agentId, {
        text,
        commandText: text,
        capabilityId,
        persona: 1,
      });
      parts.push(result.reply);
    } catch {
      // ส่วนไหนล้ม (ไม่ได้สิทธิ์/ออฟไลน์) ก็ข้าม สรุปส่วนที่เหลือ
    }
  }
  return parts.length ? parts.join('\n') : 'ยังสรุปให้ไม่ได้ครับ — ลองอนุญาตปฏิทินและตำแหน่งก่อน';
}

export interface ReminderDeps {
  notifications?: NotificationsApi;
  llm?: Llm;
  now?: () => Date;
  briefing?: () => Promise<string>;
}

export function createReminderAgent(deps: ReminderDeps = {}): AgentDefinition {
  const notifications = deps.notifications ?? defaultNotificationsApi();
  const llm = deps.llm ?? appLlm;
  const clock = deps.now ?? (() => new Date());
  const briefing = deps.briefing ?? composeBriefing;
  const DENIED = 'ยังไม่ได้อนุญาตการแจ้งเตือน — เปิดสิทธิ์แจ้งเตือนในตั้งค่าเครื่องก่อนครับ';

  return {
    id: REMINDER_AGENT_ID,
    name: 'เตือนความจำ',
    description: 'เตือนตามเวลา และสรุปเช้าทุกวัน',
    capabilities: [
      {
        id: 'reminder.set',
        label: 'ตั้งเตือน',
        patterns: [
          // "เตือนภัย…" ไม่ใช่การตั้งเตือน → ต้องตามด้วย ให้/อีก/เวลา/วัน ฯลฯ
          /^(?:ช่วย)?(?:เตือน|แจ้งเตือน)(?:ฉัน|ผม|บอส)?\s*(?<command>(?:ให้|อีก|พรุ่งนี้|วันนี้|มะรืน|ตอน|เวลา|ตี\s*\d|บ่าย|ทุ่ม|ว่า|\d).{2,})$/,
          /^remind\s+me\s+(?<command>.{3,})$/i,
        ],
        examples: ['เตือนให้โทรหาหมอพรุ่งนี้ 9 โมง', 'เตือนอีก 20 นาทีให้ปิดเตา'],
      },
      {
        id: 'reminder.list',
        label: 'ดูรายการเตือน',
        patterns: [/^(?:ดู|เช็ก|เช็ค)(?:รายการ)?(?:เตือน|การเตือน|การแจ้งเตือน)(?:ทั้งหมด)?$/],
        examples: ['ดูรายการเตือน'],
      },
      {
        id: 'briefing.on',
        label: 'เปิดสรุปเช้า',
        patterns: [/^(?:เปิด|ตั้ง)สรุป(?:ข่าว)?เช้า(?:ทุกวัน)?\s*(?<command>.*)$/],
        examples: ['เปิดสรุปเช้า 7 โมง'],
      },
      {
        id: 'briefing.off',
        label: 'ปิดสรุปเช้า',
        patterns: [/^(?:ปิด|ยกเลิก)สรุป(?:ข่าว)?เช้า$/],
        examples: ['ปิดสรุปเช้า'],
      },
      {
        id: 'briefing.now',
        label: 'สรุปวันนี้',
        patterns: [/^(?:สรุป|แจ้ง)(?:วันนี้|เช้านี้|ข่าวเช้า)(?:ให้หน่อย|ให้ฟัง)?$/],
        examples: ['สรุปวันนี้ให้หน่อย'],
      },
    ],
    async run({ commandText, capabilityId }) {
      if (capabilityId === 'briefing.now') return { reply: await briefing() };

      if (capabilityId === 'reminder.list' || capabilityId === 'briefing.off') {
        const items = await notifications.list();
        if (capabilityId === 'briefing.off') {
          const existing = items.filter((i) => i.kind === 'briefing');
          for (const i of existing) await notifications.cancel(i.id);
          return {
            reply: existing.length ? 'ปิดสรุปเช้าแล้วครับ' : 'ยังไม่ได้เปิดสรุปเช้าไว้ครับ',
          };
        }
        const reminders = items
          .filter((i) => i.kind === 'reminder' && i.at)
          .sort((a, b) => a.at!.getTime() - b.at!.getTime());
        const daily = items.find((i) => i.kind === 'briefing');
        const lines = reminders.slice(0, 5).map((r) => `${speakDate(r.at!)} ${r.body}`);
        const extra = daily?.daily
          ? ` · สรุปเช้าทุกวัน ${pad(daily.daily.hour)}:${pad(daily.daily.minute)}`
          : '';
        return {
          reply: lines.length
            ? `เตือนที่ตั้งไว้: ${lines.join(' · ')}${extra}`
            : `ยังไม่มีเตือนที่ตั้งไว้ครับ${extra}`,
        };
      }

      if (!(await notifications.ensurePermission())) return { reply: DENIED };

      if (capabilityId === 'briefing.on') {
        const time = parseClock(commandText) ?? { hour: 7, minute: 0 };
        for (const i of (await notifications.list()).filter((x) => x.kind === 'briefing'))
          await notifications.cancel(i.id);
        await notifications.scheduleDaily(
          time.hour,
          time.minute,
          BRIEFING_TITLE,
          'แตะเพื่อฟังสรุปนัดหมายและอากาศวันนี้',
          'briefing',
        );
        return { reply: `เปิดสรุปเช้าทุกวัน ${pad(time.hour)}:${pad(time.minute)} น. แล้วครับ` };
      }

      const now = clock();
      const parsed = await extractJson(
        llm,
        'แปลงประโยคเป็นการเตือน: text = สิ่งที่ต้องเตือน (สั้น ขึ้นต้นด้วยคำกริยา), at = เวลาที่ต้องเตือน',
        '{"text":"สิ่งที่ต้องเตือน","at":"ISO 8601 พร้อม offset"}',
        commandText,
        (v) => {
          const text = str(v.text);
          const at = parseDate(v.at);
          return text && at ? { text, at } : null;
        },
        now,
      );
      if (parsed.at.getTime() <= now.getTime() + 5_000) {
        throw new AssistantError(`เวลา ${speakDate(parsed.at)} ผ่านไปแล้วครับ — บอกเวลาใหม่หน่อย`);
      }
      await notifications.scheduleAt(parsed.at, 'เตือนครับบอส', parsed.text, 'reminder');
      return { reply: `ได้ครับ จะเตือนให้${parsed.text} ${speakDate(parsed.at)}` };
    },
  };
}
