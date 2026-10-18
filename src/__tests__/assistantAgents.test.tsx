import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Calendar from 'expo-calendar/legacy';
import * as Contacts from 'expo-contacts/legacy';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { AgentRegistry } from '../core/agents/AgentRegistry';
import { extractWhenWithAI } from '../features/today/aiWhen';
import { deviceCalendar, type CalendarService } from '../features/today/calendar';
import { notificationScheduler } from '../features/today/notifications';
import { ReminderStore, type ReminderScheduler } from '../features/today/reminderStore';
import { TodayScreen } from '../features/today/TodayScreen';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { createCalendarAgent } from '../modules/agents/calendar-agent';
import { createContactAgent, deviceContacts, splitRecipient, type ContactService } from '../modules/agents/contact-agent';
import { createReminderAgent, REMINDER_HELP } from '../modules/agents/reminder-agent';
import { createNoteAgent } from '../modules/agents/sample-agent';
import { nth } from '../test-utils/nth';

// อาทิตย์ 18 ต.ค. 2026 10:00
const NOW = new Date(2026, 9, 18, 10, 0, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0).getTime();

function fakeScheduler(): ReminderScheduler & { schedule: jest.Mock; cancel: jest.Mock } {
  let n = 0;
  return {
    schedule: jest.fn(async () => `n${++n}`),
    cancel: jest.fn(async () => undefined),
  };
}

const newStore = (scheduler: ReminderScheduler | null = fakeScheduler(), now = () => NOW) =>
  new ReminderStore(scheduler, 'test.reminders', now);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('ReminderStore', () => {
  test('เพิ่ม → ตั้ง notification + จดลงที่เก็บ (เรียงตามเวลา) · ลบ → ยกเลิก notification', async () => {
    const scheduler = fakeScheduler();
    const store = newStore(scheduler);
    const later = await store.add('ประชุม', at(19, 9));
    const sooner = await store.add('กินยา', at(18, 10, 10));
    expect((await store.list()).map((r) => r.text)).toEqual(['กินยา', 'ประชุม']);
    expect(later.notificationId).toBe('n1');
    expect(scheduler.schedule).toHaveBeenCalledWith(expect.objectContaining({ text: 'ประชุม', at: at(19, 9) }));

    await store.remove(sooner.id);
    expect(scheduler.cancel).toHaveBeenCalledWith('n2');
    // อ่านใหม่จาก AsyncStorage
    expect((await newStore().list()).map((r) => r.text)).toEqual(['ประชุม']);
  });

  test('เวลาผ่านไปแล้ว / ตั้ง notification ไม่ได้ → throw และไม่จด', async () => {
    const scheduler = fakeScheduler();
    scheduler.schedule.mockRejectedValueOnce(new Error('ยังไม่ได้อนุญาตการแจ้งเตือน'));
    const store = newStore(scheduler);
    await expect(store.add('x', NOW - 1)).rejects.toThrow('ผ่านไปแล้ว');
    await expect(store.add('x', at(19, 9))).rejects.toThrow('ยังไม่ได้อนุญาต');
    expect(await store.list()).toEqual([]);
  });

  test('ตัดของที่เลยเวลาเกิน 1 วันทิ้งตอนโหลด · ข้อมูลเสียถูกข้าม', async () => {
    await AsyncStorage.setItem(
      'test.reminders',
      JSON.stringify([
        { id: 'old', text: 'เก่า', at: NOW - 2 * 86_400_000, notificationId: null, createdAt: 0 },
        { id: 'bad', text: 5 },
        { id: 'ok', text: 'ใหม่', at: at(19, 9), notificationId: 'n', createdAt: 0 },
      ])
    );
    expect((await newStore().list()).map((r) => r.id)).toEqual(['ok']);
  });
});

describe('notificationScheduler (expo-notifications)', () => {
  test('ตั้งแบบวันเวลา + channel ของ Android', async () => {
    const id = await notificationScheduler.schedule({ id: 'r1', text: 'กินยา', at: at(18, 11) });
    expect(id).toBe('notif-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({ body: 'กินยา', data: { reminderId: 'r1' } }),
      trigger: { type: 'date', date: at(18, 11), channelId: 'reminders' },
    });
  });

  test('ไม่ได้สิทธิ์ → ข้อความไทยชี้ที่ตั้งค่า', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await expect(notificationScheduler.schedule({ id: 'r', text: 'x', at: at(18, 11) })).rejects.toThrow(
      'ตั้งค่าเครื่อง › แอป › A.T.O.M. › การแจ้งเตือน'
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('agent เตือนความจำ', () => {
  const run = (agent: ReturnType<typeof createReminderAgent>, commandText: string, capabilityId = 'reminder.add') =>
    agent.run({ text: commandText, commandText, capabilityId, persona: 1 });

  test('ตั้งเตือนจากประโยคไทย', async () => {
    const store = newStore();
    const agent = createReminderAgent({ store, extract: null, now: () => NOW });
    const result = await run(agent, 'อีก 10 นาที ให้กินยา');
    expect(result.reply).toBe('ตั้งเตือนแล้วครับ: “กินยา” — วันนี้ 10:10 น.');
    expect(nth(await store.list(), 0).at).toBe(at(18, 10, 10));
  });

  test('อ่านเวลาไม่ออก → ถาม AI · AI ก็ไม่รู้ → บอกวิธีพูด', async () => {
    const store = newStore();
    const extract = jest.fn(async () => ({ at: at(20, 7), text: 'ไปสนามบิน' }));
    const agent = createReminderAgent({ store, extract, now: () => NOW });
    expect((await run(agent, 'ไปสนามบินตอนฟ้าสาง')).reply).toContain('ไปสนามบิน');
    expect(extract).toHaveBeenCalledWith('ไปสนามบินตอนฟ้าสาง', NOW);

    extract.mockResolvedValueOnce(null as never);
    expect((await run(agent, 'ซื้อนม')).reply).toBe(REMINDER_HELP);
  });

  test('ดูรายการที่รออยู่', async () => {
    const store = newStore();
    const agent = createReminderAgent({ store, extract: null, now: () => NOW });
    expect((await run(agent, '', 'reminder.list')).reply).toBe('ยังไม่มีการเตือนที่รออยู่ครับ');
    await store.add('ประชุม', at(19, 9));
    expect((await run(agent, '', 'reminder.list')).reply).toBe('การเตือนที่รออยู่ 1 รายการครับ\n• พรุ่งนี้ 09:00 น. — ประชุม');
  });
});

describe('extractWhenWithAI', () => {
  test('อ่าน JSON เวลาท้องถิ่นจาก LLM (ห่อ ``` ก็ได้)', async () => {
    const chat = jest.fn(async () => '```json\n{"at":"2026-10-20 07:30","text":"ไปสนามบิน"}\n```');
    expect(await extractWhenWithAI('...', NOW, { chat })).toEqual({ at: at(20, 7, 30), text: 'ไปสนามบิน' });
    expect(JSON.stringify(chat.mock.calls)).toContain('2026-10-18 10:00 (วันอาทิตย์)');
  });

  test('ไม่มีเวลา / เวลาผ่านแล้ว / ไม่ใช่ JSON / ล้ม → null', async () => {
    for (const reply of ['{"at":null}', '{"at":"2026-10-01 07:00"}', 'ไม่ทราบครับ']) {
      expect(await extractWhenWithAI('x', NOW, { chat: async () => reply })).toBeNull();
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await extractWhenWithAI('x', NOW, { chat: () => Promise.reject(new Error('net')) })).toBeNull();
    error.mockRestore();
  });
});

describe('agent ปฏิทิน', () => {
  const fakeCalendar = (): CalendarService & { listEvents: jest.Mock; addEvent: jest.Mock } => ({
    hasPermission: jest.fn(async () => true),
    requestPermission: jest.fn(async () => true),
    listEvents: jest.fn(async () => [
      { id: 'a', title: 'ประชุมทีม', start: at(18, 14), end: at(18, 15), allDay: false, location: 'ห้อง 3' },
      { id: 'b', title: 'วันเกิดแม่', start: at(18, 0), end: at(19, 0), allDay: true, location: null },
    ]),
    addEvent: jest.fn(async () => 'e1'),
  });

  test('ดูนัดวันนี้ / พรุ่งนี้', async () => {
    const calendar = fakeCalendar();
    const agent = createCalendarAgent(calendar, () => NOW);
    const today = await agent.run({ text: 'วันนี้มีนัดอะไรบ้าง', commandText: 'วันนี้', capabilityId: 'calendar.list', persona: 1 });
    expect(today.reply).toBe('วันนี้มีนัด 2 รายการครับ\n• 14:00 ประชุมทีม (ห้อง 3)\n• ทั้งวัน วันเกิดแม่');
    expect(calendar.listEvents).toHaveBeenCalledWith(at(18, 0), at(19, 0));

    calendar.listEvents.mockResolvedValueOnce([]);
    const tomorrow = await agent.run({ text: 'ตารางพรุ่งนี้', commandText: 'พรุ่งนี้', capabilityId: 'calendar.list', persona: 1 });
    expect(tomorrow.reply).toBe('พรุ่งนี้ไม่มีนัดในปฏิทินครับ');
    expect(calendar.listEvents).toHaveBeenLastCalledWith(at(19, 0), at(20, 0));
  });

  test('ลงนัด 1 ชั่วโมง', async () => {
    const calendar = fakeCalendar();
    const agent = createCalendarAgent(calendar, () => NOW);
    const res = await agent.run({ text: '', commandText: 'หมอฟัน พรุ่งนี้ 10 โมง', capabilityId: 'calendar.add', persona: 1 });
    expect(res.reply).toBe('ลงปฏิทินแล้วครับ: “หมอฟัน” — พรุ่งนี้ 10:00 น.');
    expect(calendar.addEvent).toHaveBeenCalledWith({ title: 'หมอฟัน', start: at(19, 10), end: at(19, 11) });
  });

  test('deviceCalendar: เลือกปฏิทินหลักที่เขียนได้ · ไม่ได้สิทธิ์ = ข้อความไทย', async () => {
    jest.mocked(Calendar.getCalendarsAsync).mockResolvedValueOnce([
      { id: 'ro', allowsModifications: false, isPrimary: true },
      { id: 'other', allowsModifications: true },
      { id: 'main', allowsModifications: true, isPrimary: true },
    ] as never);
    await deviceCalendar.addEvent({ title: 'x', start: at(19, 9), end: at(19, 10) });
    expect(Calendar.createEventAsync).toHaveBeenCalledWith('main', expect.objectContaining({ title: 'x' }));

    jest.mocked(Calendar.getCalendarPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    jest.mocked(Calendar.requestCalendarPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await expect(deviceCalendar.listEvents(0, 1)).rejects.toThrow('ยังไม่ได้อนุญาตให้เข้าถึงปฏิทิน');
  });
});

describe('agent ติดต่อ', () => {
  const people = [
    { name: 'แม่', phones: ['081-234-5678'], emails: [] },
    { name: 'พี่บี', phones: [], emails: ['b@example.com'] },
  ];
  const fakeContacts = (): ContactService & { search: jest.Mock; open: jest.Mock } => ({
    search: jest.fn(async (name: string) => people.filter((p) => p.name.includes(name))),
    open: jest.fn(async () => undefined),
  });
  const run = (agent: ReturnType<typeof createContactAgent>, capabilityId: string, commandText: string) =>
    agent.run({ text: commandText, commandText, capabilityId, persona: 1 });

  test('โทร → เปิดแอปโทรศัพท์ (ไม่โทรเอง)', async () => {
    const service = fakeContacts();
    const res = await run(createContactAgent(service), 'contact.call', 'แม่');
    expect(service.open).toHaveBeenCalledWith('tel:0812345678');
    expect(res.reply).toContain('กำลังโทรหา แม่');
  });

  test('SMS + อีเมล ใส่ข้อความให้', async () => {
    const service = fakeContacts();
    const agent = createContactAgent(service);
    await run(agent, 'contact.sms', 'แม่ ว่า กลับดึกนะ');
    expect(service.open).toHaveBeenLastCalledWith(`sms:0812345678?body=${encodeURIComponent('กลับดึกนะ')}`);
    await run(agent, 'contact.email', 'คุณพี่บี ว่า ส่งงานแล้ว');
    expect(service.open).toHaveBeenLastCalledWith(
      `mailto:b@example.com?subject=${encodeURIComponent('ส่งงานแล้ว')}&body=${encodeURIComponent('ส่งงานแล้ว')}`
    );
    await run(agent, 'contact.email', 'x@y.co: hi');
    expect(service.open).toHaveBeenLastCalledWith('mailto:x@y.co?subject=hi&body=hi');
  });

  test('ไม่พบ / ไม่มีเบอร์ / ชื่อซ้ำ → ตอบโดยไม่เปิดอะไร', async () => {
    const service = fakeContacts();
    const agent = createContactAgent(service);
    expect((await run(agent, 'contact.call', 'ลุงดำ')).reply).toBe('ไม่พบ “ลุงดำ” ในรายชื่อครับ');
    expect((await run(agent, 'contact.call', 'พี่บี')).reply).toBe('“พี่บี” ไม่มีเบอร์โทรในรายชื่อครับ');
    service.search.mockResolvedValueOnce([
      { name: 'สมชาย ก', phones: ['1'], emails: [] },
      { name: 'สมชาย ข', phones: ['2'], emails: [] },
    ]);
    expect((await run(agent, 'contact.call', 'สมชาย')).reply).toContain('เจอหลายคนครับ');
    expect(service.open).not.toHaveBeenCalled();
  });

  test('splitRecipient', () => {
    expect(splitRecipient('แม่ว่า กลับดึก')).toEqual({ who: 'แม่', body: 'กลับดึก' });
    expect(splitRecipient('แม่')).toEqual({ who: 'แม่', body: '' });
  });

  test('deviceContacts: ใช้ expo-contacts + Linking', async () => {
    jest.mocked(Contacts.getContactsAsync).mockResolvedValueOnce({
      data: [{ name: 'แม่', phoneNumbers: [{ number: '081' }], emails: [] }],
    } as never);
    expect(await deviceContacts.search('แม่')).toEqual([{ name: 'แม่', phones: ['081'], emails: [] }]);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    await deviceContacts.open('tel:081');
    expect(open).toHaveBeenCalledWith('tel:081');
  });
});

describe('pattern — ข้อความไหนไป agent ไหน', () => {
  const registry = new AgentRegistry();
  // ลำดับเดียวกับ boot (โน้ตก่อน แล้วผู้ช่วยประจำวัน)
  registry.register(createNoteAgent());
  registry.register(createReminderAgent({ store: newStore(), extract: null }));
  registry.register(createCalendarAgent());
  registry.register(createContactAgent());
  const classifier = new AgentClassifier(registry);
  const route = (text: string) => {
    const out = classifier.check(text);
    return out?.intent === 'agent' ? `${out.entities.capabilityId}|${out.entities.commandText}` : null;
  };

  test.each([
    ['เตือนอีก 10 นาที ให้กินยา', 'reminder.add|อีก 10 นาที ให้กินยา'],
    ['ช่วยเตือนผมว่าพรุ่งนี้ 9 โมงประชุม', 'reminder.add|พรุ่งนี้ 9 โมงประชุม'],
    ['ตั้งเตือนบ่าย 3 โทรหาลูกค้า', 'reminder.add|บ่าย 3 โทรหาลูกค้า'],
    ['remind me to call mom in 5 minutes', 'reminder.add|call mom in 5 minutes'],
    ['มีเตือนอะไรบ้าง', 'reminder.list|'],
    ['ดูการเตือน', 'reminder.list|'],
    ['วันนี้มีนัดอะไรบ้าง', 'calendar.list|วันนี้'],
    ['ตารางพรุ่งนี้', 'calendar.list|พรุ่งนี้'],
    ['เพิ่มนัด หมอฟัน พรุ่งนี้ 10 โมง', 'calendar.add|หมอฟัน พรุ่งนี้ 10 โมง'],
    ['ลงปฏิทินว่า ประชุมทีม วันจันทร์ บ่าย 2', 'calendar.add|ประชุมทีม วันจันทร์ บ่าย 2'],
    ['โทรหาแม่', 'contact.call|แม่'],
    ['ส่งข้อความหาแม่ว่า กลับดึกนะ', 'contact.sms|แม่ว่า กลับดึกนะ'],
    ['ส่งอีเมลหาพี่บี ว่า ส่งงานแล้ว', 'contact.email|พี่บี ว่า ส่งงานแล้ว'],
    ['จดบันทึกว่า ซื้อนม', 'note.add|ซื้อนม'],
  ])('%s', (text, expected) => {
    expect(route(text)).toBe(expected);
  });

  test.each(['นัดกับแฟนไปไหนดี', 'โทรศัพท์รุ่นไหนดี', 'ข้อความนี้แปลว่าอะไร', 'วันนี้อากาศเป็นไง', 'ตารางธาตุมีกี่ธาตุ'])(
    'คุยปกติไม่โดนจับ: %s',
    (text) => {
      expect(route(text)).toBeNull();
    }
  );
});

describe('แท็บ Today', () => {
  const calendar = (): CalendarService => ({
    hasPermission: jest.fn(async () => false),
    requestPermission: jest.fn(async () => true),
    listEvents: jest.fn(async () => [
      { id: 'a', title: 'ประชุมทีม', start: Date.now() + 3_600_000, end: Date.now() + 7_200_000, allDay: false, location: null },
    ]),
    addEvent: jest.fn(async () => 'x'),
  });

  test('พิมพ์ประโยคเดียว → ตั้งเตือน + โชว์ในรายการ · ลบได้', async () => {
    const scheduler = fakeScheduler();
    const store = new ReminderStore(scheduler, 'test.today');
    await render(<TodayScreen store={store} calendar={calendar()} extract={async () => null} />);
    await fireEvent.changeText(screen.getByLabelText('ตั้งเตือน'), 'กินยา อีก 30 นาที');
    await fireEvent.press(screen.getByLabelText('เพิ่มการเตือน'));
    expect(await screen.findByText('กินยา')).toBeTruthy();
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByLabelText('ลบการเตือน กินยา'));
    expect(scheduler.cancel).toHaveBeenCalledWith('n1');
    expect(screen.queryByText('กินยา')).toBeNull();
  });

  test('ไม่มีเวลาในประโยค → บอกวิธีพิมพ์', async () => {
    await render(<TodayScreen store={newStore()} calendar={calendar()} extract={async () => null} />);
    await fireEvent.changeText(screen.getByLabelText('ตั้งเตือน'), 'ซื้อนม');
    await fireEvent.press(screen.getByLabelText('เพิ่มการเตือน'));
    expect(await screen.findByText(/ยังไม่รู้ว่าจะเตือนเมื่อไร/)).toBeTruthy();
  });

  test('ปฏิทิน: ยังไม่ได้สิทธิ์ → ปุ่มอนุญาต → แสดงนัดวันนี้', async () => {
    const cal = calendar();
    await render(<TodayScreen store={newStore()} calendar={cal} extract={async () => null} />);
    await fireEvent.press(await screen.findByText('อนุญาตให้ดูปฏิทิน'));
    expect(await screen.findByText('ประชุมทีม')).toBeTruthy();
    expect(cal.requestPermission).toHaveBeenCalled();
  });
});
