/**
 * @file เครื่องมือ "ค้นหาความสามารถ" ให้ agent — CONCEPT ข้อ 3 (หาความสามารถเอง)
 *
 * agent เรียก `find_capability` เพื่อค้นว่ามี **MCP server ในคลังทางการ** ตัวไหนช่วยงานที่กำลังทำได้
 * (ทักษะที่ติดตั้งแล้วไม่ต้องค้น — มันอยู่ในรายการ tool ของ agent อยู่แล้ว) · **ค้นอย่างเดียว ไม่ติดตั้ง/ไม่เปิดใช้**
 * การเพิ่ม MCP หรือเขียนทักษะใหม่ยังต้องให้บอสอนุมัติเองตามกรอบความปลอดภัย (CONCEPT ข้อ 3)
 *
 * ⚠️ ผลมีเนื้อหาจากคลังสาธารณะ (ไม่น่าเชื่อถือ) → กันคำสั่งแฝง 2 ชั้น (ไม่ใช่กันครบ):
 *   1. ชื่อ/คำอธิบายของ server ผ่าน `toPromptLine()` (บีบบรรทัดเดียว + redact รูปแบบ injection ที่รู้จัก)
 *   2. ตั้ง `external: true` → harness ถือว่า "เห็นของนอก" → คำสั่งที่แตะเครื่อง/PC/อัลตรอนหลังจากนี้ต้องให้บอสยืนยัน
 *   (ยังกันคำสั่งแฝงที่ชักจูงคำตอบสุดท้าย/เครื่องมือไม่เสี่ยงไม่ได้ทั้งหมด — เป็น blacklist แคบ)
 *
 * อยู่ใน features/ เพราะ core import features ไม่ได้ (ใช้ mcpRegistry)
 */

import type {
  AgentToolCall,
  AgentToolProvider,
  AgentToolResult,
  AgentToolSpec,
} from '../../core/agent/types';
import { toPromptLine } from '../../core/memory/promptLine';
import { searchMcpRegistry, type RegistrySearch } from '../marketplace/mcpRegistry';

export const FIND_CAPABILITY_TOOL = 'find_capability';
/** จำนวนผลสูงสุด (กัน prompt บวม) */
const MAX_RESULTS = 5;

export interface DiscoveryDeps {
  /** ค้นคลัง MCP (ค่าเริ่มต้น = คลังทางการ) */
  search?: RegistrySearch;
}

/** ค่าแรกที่เป็นสตริงไม่ว่าง (กัน args.query = "" บัง call.text ที่มีของจริง) */
function firstNonEmpty(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * เครื่องมือค้นหาความสามารถ (read-only) — ไม่ throw: คลังล่มก็คืนข้อความไทย (fail-open)
 * ผลตั้ง `external: true` เสมอ (เนื้อหาจากคลังสาธารณะ) เพื่อให้ด่านยืนยันคำสั่งเสี่ยงทำงาน
 */
export function createDiscoveryTool(deps: DiscoveryDeps = {}): AgentToolProvider {
  const search = deps.search ?? searchMcpRegistry;

  return {
    listTools(): AgentToolSpec[] {
      return [
        {
          id: FIND_CAPABILITY_TOOL,
          name: 'ค้นหาความสามารถ',
          description:
            'ค้นคลัง MCP ว่ามี server ตัวไหนช่วยงานนี้ได้ เมื่อเครื่องมือที่มีอยู่ไม่พอ ' +
            '(ค้นอย่างเดียว — การติดตั้ง MCP หรือเขียนทักษะใหม่ต้องให้บอสอนุมัติเอง)',
          source: 'skill',
        },
      ];
    },

    async call(call: AgentToolCall): Promise<AgentToolResult> {
      if (call.tool !== FIND_CAPABILITY_TOOL) {
        return { ok: false, output: `ไม่รู้จักเครื่องมือ ${call.tool}` };
      }
      const query = firstNonEmpty(
        call.args?.['query'],
        call.args?.['q'],
        call.args?.['text'],
        call.text,
      );
      if (!query) {
        return { ok: false, output: 'ต้องระบุว่าจะค้นหาความสามารถเรื่องอะไร' };
      }

      let servers;
      try {
        servers = (await search(query)).servers.slice(0, MAX_RESULTS);
      } catch {
        // คลัง MCP ล่ม/เน็ตมีปัญหา — fail-open
        return {
          ok: false,
          output: 'ค้นคลัง MCP ไม่สำเร็จตอนนี้ — ลองใหม่อีกครั้งภายหลัง',
          external: true,
        };
      }

      if (servers.length === 0) {
        return {
          ok: true,
          external: true,
          output: `ไม่พบ MCP ที่ตรงกับ "${query}" — อาจต้องเขียนทักษะใหม่ (รอบอสอนุมัติ)`,
        };
      }

      const lines = ['MCP ในคลัง (ยังไม่ติดตั้ง — บอสต้องอนุมัติก่อนใช้):'];
      for (const s of servers) {
        const token = s.needsToken ? ' (ต้องใส่ token)' : '';
        // ชื่อ/คำอธิบายมาจากคลังสาธารณะ → บีบ + redact ผ่าน guard ก่อนเข้า prompt ของ agent
        const title = toPromptLine(s.title || s.name);
        const desc = toPromptLine(s.description);
        lines.push(`- ${title}: ${desc}${token}`);
      }
      return { ok: true, external: true, output: lines.join('\n') };
    },
  };
}
