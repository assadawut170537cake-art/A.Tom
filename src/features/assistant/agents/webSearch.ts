/**
 * @file ค้นเว็บด้วย Google Search ของ Gemini (grounding) — ข้อมูลสด: ข่าว ราคา ผลแข่ง ฯลฯ
 * pattern แคบโดยตั้งใจ (ต้องขึ้นต้นด้วยคำสั่งค้น หรือมีคำว่า ข่าว/ราคา + วันนี้/ล่าสุด) ไม่แย่งประโยคคุยปกติ
 */

import type { AgentDefinition } from '../../../core/agents/types';
import { ProviderError } from '../../../core/http/errors';
import { AssistantError } from '../shared/errors';
import { assistantModel, geminiGenerate, sourcesOf, textOf } from '../shared/gemini';

export const WEB_SEARCH_AGENT_ID = 'web-search';

export interface SearchResult {
  text: string;
  sources: string[];
}

export type SearchFn = (query: string) => Promise<SearchResult>;

export const geminiSearch: SearchFn = async (query) => {
  const response = await geminiGenerate(await assistantModel('text'), {
    contents: [{ role: 'user', parts: [{ text: query }] }],
    systemInstruction: {
      parts: [
        {
          text: 'ตอบเป็นภาษาไทย สั้น กระชับ ไม่เกิน 3 ประโยค เหมาะอ่านออกเสียง ไม่ใส่ลิงก์ ไม่ใช้ markdown ระบุตัวเลข/วันที่ให้ชัด',
        },
      ],
    },
    tools: [{ google_search: {} }],
  }).catch((e: unknown) => {
    if (e instanceof ProviderError && (e.kind === 'auth' || e.kind === 'bad_request')) {
      throw new AssistantError(
        'Gemini key นี้ค้นเว็บไม่ได้ — อาจต้องเปิดบิลใน Google AI Studio ครับ',
      );
    }
    throw e;
  });
  const text = textOf(response);
  if (!text) throw new AssistantError('ค้นแล้วแต่ไม่ได้คำตอบกลับมาครับ');
  return { text, sources: sourcesOf(response) };
};

export function createWebSearchAgent(search: SearchFn = geminiSearch): AgentDefinition {
  return {
    id: WEB_SEARCH_AGENT_ID,
    name: 'ค้นเว็บ',
    description: 'ค้นข้อมูลสดจากเว็บด้วย Google Search ของ Gemini',
    capabilities: [
      {
        id: 'web.search',
        label: 'ค้นเว็บ',
        patterns: [
          /^(?:ช่วย)?(?:ค้นเว็บ|ค้นหาในเว็บ|เสิร์ช|search|google|กูเกิล|ค้นหา|หาข้อมูล)(?:เรื่อง|ว่า|หน่อย|:)?\s*(?<command>.{3,})$/i,
          /^(?<command>(?=.*(?:ข่าว|ราคาทอง|ราคาน้ำมัน|ราคาหุ้น|ผลบอล|ผลการแข่งขัน|หวย))(?=.*(?:วันนี้|ล่าสุด|ตอนนี้|เมื่อวาน)).+)$/,
        ],
        examples: ['ค้นเว็บ ราคาทองวันนี้', 'ข่าวล่าสุดเรื่องเศรษฐกิจ'],
      },
    ],
    async run({ commandText }) {
      const { text, sources } = await search(commandText);
      const via = sources.length ? ` (อ้างอิง ${sources.slice(0, 2).join(', ')})` : '';
      return { reply: `${text}${via}` };
    },
  };
}
