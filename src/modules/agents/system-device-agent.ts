/**
 * @file SystemDeviceAgent: ผู้ช่วยควบคุมอุปกรณ์ สภาพอากาศ ปฏิทิน นาฬิกาปลุก และการตั้งค่าระบบ (Parity กับ Jarvis 0.4.2)
 */

import { agentRegistry, type AgentRegistry } from '../../core/agents/AgentRegistry';
import type { AgentDefinition } from '../../core/agents/types';
import {
  fetchWeather,
  listEventsForPeriod,
  setDeviceAlarm,
  scheduleReminder,
  searchContacts,
  openDeviceSettings,
  openSpotifySearch,
  type SettingTarget,
} from '../system';

export const SYSTEM_AGENT_ID = 'system-device';

export function createSystemDeviceAgent(): AgentDefinition {
  return {
    id: SYSTEM_AGENT_ID,
    name: 'ระบบและอุปกรณ์',
    description: 'ควบคุมการตั้งค่าเครื่อง สภาพอากาศ ตารางนัดหมาย ตั้งปลุก และเพลง',
    capabilities: [
      {
        id: 'system.weather',
        label: 'เช็คสภาพอากาศ',
        patterns: [
          /^(?:ช่วย)?(?:เช็ค|ดู|ตรวจ)?(?:สภาพ)?อากาศ(?:\s+(?<command>.*))?$/,
          /^(?:ฝนตกไหม|ร้อนไหม|หนาวไหม|อุณหภูมิเท่าไหร่)$/,
          /^(?:weather|forecast)(?:\s+(?<command>.*))?$/i,
        ],
        examples: ['อากาศวันนี้', 'เช็คสภาพอากาศ', 'weather'],
      },
      {
        id: 'system.alarm',
        label: 'ตั้งนาฬิกาปลุก',
        patterns: [
          /^(?:ช่วย)?ตั้งปลุก(?:\s*(?:เวลา|ตอน))?\s*(?<command>\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:โมง|นาฬิกา|am|pm)).*$/i,
          /^set\s+alarm(?:\s+(?:for|to))?\s*(?<command>.*)$/i,
        ],
        examples: ['ตั้งปลุก 7 โมงเช้า', 'ตั้งปลุกเวลา 06:30', 'set alarm for 7:00'],
      },
      {
        id: 'system.calendar',
        label: 'เช็คนัดหมายและปฏิทิน',
        patterns: [
          /^(?:ดู|เช็ค|เปิด)?(?:ตารางงาน|นัดหมาย|กำหนดการ|ปฏิทิน)(?:วันนี้|พรุ่งนี้)?$/,
          /^(?:show\s+|my\s+)?(?:calendar|agenda|schedule)$/i,
        ],
        examples: ['ดูตารางงานวันนี้', 'มีนัดอะไรบ้าง', 'calendar'],
      },
      {
        id: 'system.reminder',
        label: 'ตั้งเตือนความจำ',
        patterns: [
          /^(?:ช่วย)?เตือน(?:ความจำ|ฉัน)?(?:\s*ว่า|\s*:)\s*(?<command>.*)$/,
          /^remind\s+me(?:\s+to)?\s*(?<command>.*)$/i,
        ],
        examples: ['เตือนฉันว่า ซื้อของเข้าบ้าน', 'remind me: call mom'],
      },
      {
        id: 'system.settings',
        label: 'เปิดการตั้งค่าระบบ',
        patterns: [
          /^(?:เปิด|ไปที่)?(?:การตั้งค่า|ตั้งค่า)\s*(?<command>wifi|ไวไฟ|bluetooth|บลูทูธ|เสียง|จอ|แสง|แบตเตอรี่|แอป)?$/i,
          /^open\s+settings(?:\s+(?<command>.*))?$/i,
        ],
        examples: ['เปิดการตั้งค่า wifi', 'ตั้งค่าบลูทูธ', 'open settings bluetooth'],
      },
      {
        id: 'system.spotify',
        label: 'เล่นเพลงบน Spotify',
        patterns: [
          /^(?:เปิดเพลง|เล่นเพลง|เปิด spotify)\s*(?<command>.*)$/i,
          /^play\s+(?:song\s+|music\s+)?(?<command>.*)$/i,
        ],
        examples: ['เปิดเพลง ลิซ่า', 'เล่นเพลง jazz', 'play music rock'],
      },
      {
        id: 'system.contacts',
        label: 'ค้นหารายชื่อผู้ติดต่อ',
        patterns: [
          /^(?:ค้นหา|หา)?(?:รายชื่อ|เบอร์|เบอร์โทร)(?:\s*(?:ของ|คุณ))?\s+(?<command>.+)$/,
          /^(?:find|search)\s+(?:contact|phone)\s+(?<command>.+)$/i,
        ],
        examples: ['ค้นหารายชื่อ สมชาย', 'หาเบอร์โทร นิดา', 'search contact John'],
      },
    ],
    async run({ commandText, capabilityId }) {
      if (capabilityId === 'system.weather') {
        try {
          const data = await fetchWeather();
          return {
            reply: `ขณะนี้ที่${data.city} อุณหภูมิ ${data.temperature}°C สภาพอากาศ${data.condition}ครับ`,
            visualCard: { type: 'weather', data },
          };
        } catch {
          return { reply: 'ไม่สามารถดึงข้อมูลสภาพอากาศได้ในขณะนี้ครับ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตอีกครั้ง' };
        }
      }

      if (capabilityId === 'system.alarm') {
        // Parse time e.g. "07:30", "7:00", "7 โมง"
        let hour = 7;
        let minute = 0;
        const match = commandText.match(/(\d{1,2})[:.](\d{2})/);
        if (match && match[1] && match[2]) {
          hour = parseInt(match[1], 10);
          minute = parseInt(match[2], 10);
        } else {
          const hMatch = commandText.match(/(\d{1,2})/);
          if (hMatch && hMatch[1]) hour = parseInt(hMatch[1], 10);
        }

        const res = await setDeviceAlarm({ hour, minutes: minute, message: 'A.T.O.M. Alarm' });
        return {
          reply: `${res.note}ครับ`,
          visualCard: {
            type: 'reminder',
            data: {
              title: 'นาฬิกาปลุก',
              triggerTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
              isAlarm: true,
            },
          },
        };
      }

      if (capabilityId === 'system.calendar') {
        try {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          const events = await listEventsForPeriod(start, end);
          const count = events.length;
          const reply = count === 0
            ? 'วันนี้ไม่มีกำหนดการในปฏิทินครับ'
            : `วันนี้คุณมี ${count} นัดหมายในปฏิทินครับ`;
          return {
            reply,
            visualCard: { type: 'calendar', data: events },
          };
        } catch (e) {
          return { reply: `ไม่สามารถเปิดปฏิทินได้: ${e instanceof Error ? e.message : 'กรุณาอนุญาตสิทธิ์เข้าถึง'}` };
        }
      }

      if (capabilityId === 'system.reminder') {
        const text = commandText.trim() || 'รายการเตือนความจำ';
        const trigger = new Date(Date.now() + 60 * 60 * 1000); // 1 ชั่วโมงถัดไปเป็นค่าเริ่มต้น
        try {
          await scheduleReminder(text, trigger);
          return {
            reply: `บันทึกการแจ้งเตือน "${text}" ให้แล้วครับ`,
            visualCard: {
              type: 'reminder',
              data: {
                title: text,
                triggerTime: trigger.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isAlarm: false,
              },
            },
          };
        } catch {
          return { reply: `บันทึกเตือนความจำ: ${text}` };
        }
      }

      if (capabilityId === 'system.settings') {
        let target: SettingTarget = 'apps';
        const lower = (commandText || '').toLowerCase();
        if (lower.includes('wifi') || lower.includes('ไวไฟ')) target = 'wifi';
        else if (lower.includes('blue') || lower.includes('บลู')) target = 'bluetooth';
        else if (lower.includes('เสียง')) target = 'sound';
        else if (lower.includes('จอ') || lower.includes('แสง')) target = 'display';
        else if (lower.includes('แบต')) target = 'battery';

        const res = await openDeviceSettings(target);
        return {
          reply: `${res.message}ครับ`,
          visualCard: { type: 'device', data: { target, message: res.message } },
        };
      }

      if (capabilityId === 'system.spotify') {
        const query = commandText.trim() || 'Top Hits';
        await openSpotifySearch(query);
        return {
          reply: `เปิดค้นหาเพลง "${query}" บน Spotify แล้วครับ`,
          visualCard: { type: 'media', data: { title: query, app: 'spotify', query } },
        };
      }

      if (capabilityId === 'system.contacts') {
        const query = commandText.trim();
        const contacts = await searchContacts(query);
        const first = contacts[0];
        if (!first) {
          return { reply: `ไม่พบรายชื่อผู้ติดต่อที่ตรงกับ "${query}" ครับ` };
        }
        const phone = first.phoneNumbers?.[0];
        return {
          reply: `พบรายชื่อ ${first.name}${phone ? ` เบอร์โทร ${phone}` : ''} ครับ`,
          visualCard: {
            type: 'contact',
            data: first,
          },
        };
      }

      return { reply: 'รับทราบคำสั่งครับ' };
    },
  };
}

/** ลงทะเบียน System Device Agent เข้า AgentRegistry */
export function registerSystemDeviceAgent(registry: AgentRegistry = agentRegistry): void {
  if (!registry.has(SYSTEM_AGENT_ID)) {
    registry.register(createSystemDeviceAgent());
  }
}
