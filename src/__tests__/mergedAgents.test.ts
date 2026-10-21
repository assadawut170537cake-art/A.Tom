import { agentRegistry } from '../core/agents/AgentRegistry';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { registerAssistantAgents } from '../features/assistant';
import { registerDeviceAgent } from '../modules/agents/device-agent';
import { registerNotebookLMAgent } from '../modules/agents/notebooklm-agent';
import { registerSampleAgents } from '../modules/agents/sample-agent';
import { registerStandbyAgent } from '../modules/agents/standby-agent';
import { registerTaskAgent } from '../modules/agents/task-agent';
import { registerTodayAgent } from '../modules/agents/today-agent';
import { registerUltronAgent } from '../modules/agents/ultron-agent';

/** ลำดับเดียวกับ bootApp() — agent ของสองชุดงาน (มือถือ + ผู้ช่วยส่วนตัวจาก PC) ต้องไม่แย่งคำสั่งกัน */
beforeAll(() => {
  agentRegistry.clear();
  registerSampleAgents();
  registerStandbyAgent();
  registerUltronAgent();
  registerNotebookLMAgent();
  registerTodayAgent();
  registerAssistantAgents();
  registerTaskAgent();
  registerDeviceAgent();
});
afterAll(() => agentRegistry.clear());

const route = (text: string) => {
  const r = new AgentClassifier(agentRegistry).check(text);
  return r?.intent === 'agent' ? r.entities.agentId : null;
};

test.each([
  ['เปิดไฟฉาย', 'device'],
  ['ปิดไฟฉาย', 'device'],
  ['ปรับเสียง 30', 'device'],
  ['เพิ่มงาน ซื้อของ', 'today'],
  ['งานวันนี้มีอะไรบ้าง', 'today'],
  ['ส่งเข้า NotebookLM: https://a.com', 'notebooklm'],
  ['ฝากงาน: ค้นคว้าเรื่อง AI', 'task'],
  ['เปิดโหมดเฝ้า', 'standby'],
  ['อัลตรอน ทำว่า สุ่มเลข', 'ultron'],
])('"%s" → %s', (text, agent) => {
  expect(route(text)).toBe(agent);
});

test('agent ทุกตัวมี id ไม่ซ้ำ', () => {
  const ids = agentRegistry.list().map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test.each([
  'ตั้งปลุก 6 โมงครึ่ง',
  'เตือนอีก 2 นาทีให้ปิดเตา',
  'ค้นเว็บ ราคาทองวันนี้',
  'วาดรูปแมวใส่หมวก',
  'วันนี้มีนัดอะไรบ้าง',
])('คำสั่งผู้ช่วยส่วนตัว "%s" ไม่ถูก agent ฝั่งมือถือแย่ง', (text) => {
  expect([
    'device',
    'today',
    'notebooklm',
    'task',
    'standby',
    'ultron',
    'note',
    null,
  ]).not.toContain(route(text));
});
