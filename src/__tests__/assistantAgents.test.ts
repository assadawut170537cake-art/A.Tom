import { AgentRegistry } from '../core/agents/AgentRegistry';
import { AgentClassifier } from '../features/router/classifiers/AgentClassifier';
import { registerAssistantAgents } from '../features/assistant';
import {
  createCalendarAgent,
  rangeFor,
  summarizeEvents,
  type CalendarApi,
  type CalendarEvent,
} from '../features/assistant/agents/calendar';
import {
  createClockAgent,
  describeDuration,
  parseClock,
  parseDuration,
} from '../features/assistant/agents/clock';
import {
  createContactsAgent,
  pickNumber,
  splitSms,
  type ContactsApi,
} from '../features/assistant/agents/contacts';
import {
  AssistantStore,
  createCustomAssistantsAgent,
  invokePatterns,
} from '../features/assistant/agents/customAssistants';
import {
  ALLOWED_SERVICES,
  controllable,
  createHomeAgent,
  rankEntities,
  type HaClient,
  type HaEntity,
} from '../features/assistant/agents/homeAssistant';
import { createImageAgent } from '../features/assistant/agents/image';
import {
  createPlaceAgent,
  distanceMeters,
  nearestPlaces,
  placeNameIn,
  spokenDistance,
  summarizeWeather,
  weatherText,
  type PlaceApi,
} from '../features/assistant/agents/place';
import { createReminderAgent } from '../features/assistant/agents/reminder';
import { createVisionAgent } from '../features/assistant/agents/vision';
import { createWebSearchAgent } from '../features/assistant/agents/webSearch';
import type { NotificationsApi, ScheduledItem } from '../features/assistant/notifications';
import { parseJsonLoose, type Llm } from '../features/assistant/shared/llm';

const NOW = new Date(2026, 9, 21, 16, 20, 0); // พุธ 21 ต.ค. 2026 16:20 (เวลาท้องถิ่น)
const run = (
  agent: ReturnType<typeof createClockAgent>,
  commandText: string,
  capabilityId: string,
  text = commandText,
) => agent.run({ text, commandText, capabilityId, persona: 1 });
const llmReturning = (json: unknown): Llm => ({
  complete: async () => `\`\`\`json\n${JSON.stringify(json)}\n\`\`\``,
});

describe('clock parsing', () => {
  it.each([
    ['6 โมงครึ่ง', 6, 30],
    ['ตี 5', 5, 0],
    ['7:30', 7, 30],
    ['7.45 เย็น', 19, 45],
    ['4 โมงเย็น', 16, 0],
    ['บ่าย 2', 14, 0],
    ['บ่าย 2 โมงครึ่ง', 14, 30],
    ['2 ทุ่ม', 20, 0],
    ['ทุ่มครึ่ง', null, null],
    ['เที่ยง', 12, 0],
    ['เที่ยงคืน', 0, 0],
    ['๖ โมงเช้า', 6, 0],
    ['18:05', 18, 5],
  ])('parseClock(%s)', (text, hour, minute) => {
    const parsed = parseClock(text);
    if (hour === null) expect(parsed).toBeNull();
    else expect(parsed).toEqual({ hour, minute });
  });

  it('parseClock: อ่านไม่ออก/ค่าเกิน → null', () => {
    expect(parseClock('พรุ่งนี้')).toBeNull();
    expect(parseClock('25:99')).toBeNull();
  });

  it.each([
    ['10 นาที', 600],
    ['1 ชั่วโมง 30 นาที', 5400],
    ['ครึ่งชั่วโมง', 1800],
    ['90 วินาที', 90],
    ['๒ นาที', 120],
    ['1.5 ชั่วโมง', 5400],
  ])('parseDuration(%s)', (text, seconds) => expect(parseDuration(text)).toBe(seconds));

  it('parseDuration: ไม่มีหน่วย → null · describeDuration', () => {
    expect(parseDuration('สักพัก')).toBeNull();
    expect(describeDuration(5430)).toBe('1 ชั่วโมง 30 นาที 30 วินาที');
  });
});

describe('clock agent', () => {
  it('ตั้งปลุก/ตั้งเวลาผ่าน intent ของ Android ข้าม UI', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const agent = createClockAgent({
      platform: 'android',
      launch: async (a, e) => void calls.push([a, e]),
    });
    expect((await run(agent, '6 โมงครึ่ง', 'alarm.set')).reply).toContain('06:30');
    expect(calls[0]?.[0]).toBe('android.intent.action.SET_ALARM');
    expect(calls[0]?.[1]).toMatchObject({
      'android.intent.extra.alarm.HOUR': 6,
      'android.intent.extra.alarm.MINUTES': 30,
      'android.intent.extra.alarm.SKIP_UI': true,
    });
    expect((await run(agent, '10 นาที', 'timer.set')).reply).toContain('10 นาที');
    expect(calls[1]).toEqual([
      'android.intent.action.SET_TIMER',
      { 'android.intent.extra.alarm.LENGTH': 600, 'android.intent.extra.alarm.SKIP_UI': true },
    ]);
  });

  it('เวลาที่อ่านไม่ออก/iOS → ข้อความไทยที่บอกทางแก้ (throw AssistantError)', async () => {
    const android = createClockAgent({ platform: 'android', launch: async () => {} });
    await expect(run(android, 'สักพัก', 'alarm.set')).rejects.toThrow('ไม่เข้าใจเวลา');
    await expect(run(android, 'นานๆ', 'timer.set')).rejects.toThrow('ไม่เข้าใจระยะเวลา');
    const ios = createClockAgent({ platform: 'ios', launch: async () => {} });
    await expect(run(ios, '7:00', 'alarm.set')).rejects.toThrow('Android');
  });

  it('อ่านคลิปบอร์ด: ว่าง / ยาวเกินถูกตัด', async () => {
    const empty = createClockAgent({ readClipboard: async () => '  ' });
    expect((await run(empty, '', 'clipboard.read')).reply).toContain('ว่าง');
    const long = createClockAgent({ readClipboard: async () => 'ก'.repeat(500) });
    expect((await run(long, '', 'clipboard.read')).reply).toContain('ยาว 500');
  });
});

describe('contacts agent', () => {
  const makeApi = (hits: Awaited<ReturnType<ContactsApi['find']>>) => {
    const opened: string[] = [];
    const api: ContactsApi = { find: async () => hits, open: async (u) => void opened.push(u) };
    return { api, opened };
  };

  it('pickNumber / splitSms', () => {
    expect(
      pickNumber({
        name: 'a',
        phones: [
          { label: 'home', number: '02-111' },
          { label: 'mobile', number: '081 234 5678' },
        ],
      }),
    ).toBe('0812345678');
    expect(pickNumber({ name: 'a', phones: [] })).toBeNull();
    expect(splitSms('แม่ ว่า ถึงบ้านแล้ว')).toEqual({ name: 'แม่', body: 'ถึงบ้านแล้ว' });
    expect(splitSms('แม่')).toEqual({ name: 'แม่', body: '' });
  });

  it('โทร: เปิดหน้าโทรให้ (ไม่โทรเอง)', async () => {
    const { api, opened } = makeApi([{ name: 'แม่', phones: [{ number: '081-111-2222' }] }]);
    const r = await run(createContactsAgent(api), 'แม่', 'contact.call');
    expect(opened).toEqual(['tel:0811112222']);
    expect(r.reply).toContain('กดโทรได้เลย');
  });

  it('ส่งข้อความ: เปิดหน้าร่างพร้อมเนื้อความ', async () => {
    const { api, opened } = makeApi([{ name: 'แม่', phones: [{ number: '0811112222' }] }]);
    await run(createContactsAgent(api), 'แม่ ว่า ถึงบ้านแล้ว', 'contact.sms');
    expect(opened[0]).toBe(`sms:0811112222?body=${encodeURIComponent('ถึงบ้านแล้ว')}`);
  });

  it('หลายคนที่ชื่อใกล้กัน → ถามกลับ ไม่เดา · ไม่พบ · ไม่มีเบอร์ · ไม่ได้สิทธิ์', async () => {
    const many = makeApi([
      { name: 'สมชาย ใจดี', phones: [{ number: '081' }] },
      { name: 'สมชาย รักดี', phones: [{ number: '082' }] },
    ]);
    const r = await run(createContactsAgent(many.api), 'สมชาย', 'contact.call');
    expect(r.reply).toContain('หลายคน');
    expect(many.opened).toEqual([]);
    expect(
      (await run(createContactsAgent(makeApi([]).api), 'ใครไม่รู้', 'contact.call')).reply,
    ).toContain('ไม่พบ');
    expect(
      (
        await run(
          createContactsAgent(makeApi([{ name: 'แม่', phones: [] }]).api),
          'แม่',
          'contact.call',
        )
      ).reply,
    ).toContain('ยังไม่มีเบอร์');
    expect(
      (await run(createContactsAgent(makeApi(null).api), 'แม่', 'contact.call')).reply,
    ).toContain('ยังไม่ได้อนุญาต');
  });

  it('ชื่อตรงเป๊ะชนะชื่อที่ซ้อนกัน', async () => {
    const { api, opened } = makeApi([
      { name: 'แม่', phones: [{ number: '081' }] },
      { name: 'แม่ครัว', phones: [{ number: '082' }] },
    ]);
    await run(createContactsAgent(api), 'แม่', 'contact.call');
    expect(opened).toEqual(['tel:081']);
  });

  it('lookup อ่านเบอร์ทีละหลัก', async () => {
    const { api } = makeApi([{ name: 'แม่', phones: [{ number: '0812' }] }]);
    expect((await run(createContactsAgent(api), 'แม่', 'contact.lookup')).reply).toBe(
      'เบอร์ของ แม่ คือ 0 8 1 2',
    );
  });
});

describe('calendar agent', () => {
  const makeApi = (events: CalendarEvent[] = [], granted = true) => {
    const created: unknown[] = [];
    const api: CalendarApi = {
      ensurePermission: async () => granted,
      events: async () => events,
      create: async (e) => void created.push(e),
    };
    return { api, created };
  };

  it('rangeFor: วันนี้/พรุ่งนี้/มะรืน/สัปดาห์', () => {
    expect(rangeFor('ดูนัด', NOW).label).toBe('วันนี้');
    expect(rangeFor('ดูนัดพรุ่งนี้', NOW).start.getDate()).toBe(22);
    expect(rangeFor('มะรืนนี้', NOW).start.getDate()).toBe(23);
    const week = rangeFor('นัดสัปดาห์นี้', NOW);
    expect(week.end.getDate() - week.start.getDate()).toBe(7);
  });

  it('summarizeEvents: ว่าง / เรียงเวลา / ตัดที่ 5 รายการ', () => {
    expect(summarizeEvents([], 'วันนี้', false)).toContain('ไม่มีนัด');
    const ev = (h: number, title: string): CalendarEvent => ({
      title,
      start: new Date(2026, 9, 21, h),
      end: new Date(2026, 9, 21, h + 1),
    });
    const text = summarizeEvents([ev(15, 'บ่าย'), ev(9, 'เช้า')], 'วันนี้', false);
    expect(text.indexOf('เช้า')).toBeLessThan(text.indexOf('บ่าย'));
    expect(
      summarizeEvents(
        Array.from({ length: 7 }, (_, i) => ev(8 + i, `n${i}`)),
        'วันนี้',
        false,
      ),
    ).toContain('อีก 2 รายการ');
  });

  it('ดูนัด: อ่านจากปฏิทิน', async () => {
    const { api } = makeApi([
      { title: 'ประชุมทีม', start: new Date(2026, 9, 21, 17), end: new Date(2026, 9, 21, 18) },
    ]);
    const agent = createCalendarAgent({ api, now: () => NOW });
    const r = await agent.run({
      text: 'วันนี้มีนัดอะไรบ้าง',
      commandText: 'วันนี้มีนัดอะไรบ้าง',
      capabilityId: 'calendar.agenda',
      persona: 1,
    });
    expect(r.reply).toContain('17:00 ประชุมทีม');
  });

  it('สร้างนัด: LLM แปลงวันเวลา → ลงปฏิทิน (end เริ่มต้น +1 ชั่วโมง)', async () => {
    const { api, created } = makeApi();
    const llm = llmReturning({
      title: 'พบหมอ',
      start: '2026-10-22T10:00:00+07:00',
      end: null,
      location: 'โรงพยาบาล',
    });
    const agent = createCalendarAgent({ api, llm, now: () => NOW });
    const r = await agent.run({
      text: 'นัดหมอพรุ่งนี้ 10 โมง',
      commandText: 'หมอพรุ่งนี้ 10 โมง',
      capabilityId: 'calendar.create',
      persona: 1,
    });
    expect(r.reply).toContain('พบหมอ');
    const event = created[0] as { start: Date; end: Date; location: string };
    expect(event.end.getTime() - event.start.getTime()).toBe(3_600_000);
    expect(event.location).toBe('โรงพยาบาล');
  });

  it('สร้างนัด: เวลาที่ผ่านไปแล้ว → ไม่ลง · LLM ตอบเพี้ยน → ข้อความไทย · ไม่ได้สิทธิ์', async () => {
    const past = makeApi();
    const pastAgent = createCalendarAgent({
      api: past.api,
      llm: llmReturning({ title: 'x', start: '2026-10-20T10:00:00+07:00' }),
      now: () => NOW,
    });
    expect(
      (
        await pastAgent.run({
          text: 'x',
          commandText: 'x',
          capabilityId: 'calendar.create',
          persona: 1,
        })
      ).reply,
    ).toContain('ผ่านไปแล้ว');
    expect(past.created).toEqual([]);
    const bad = createCalendarAgent({
      api: makeApi().api,
      llm: { complete: async () => 'ไม่รู้' },
      now: () => NOW,
    });
    await expect(
      bad.run({ text: 'x', commandText: 'x', capabilityId: 'calendar.create', persona: 1 }),
    ).rejects.toThrow('ไม่เข้าใจคำสั่ง');
    const denied = createCalendarAgent({ api: makeApi([], false).api, now: () => NOW });
    expect(
      (
        await denied.run({
          text: 'x',
          commandText: 'x',
          capabilityId: 'calendar.agenda',
          persona: 1,
        })
      ).reply,
    ).toContain('ยังไม่ได้อนุญาต');
  });
});

describe('place agent', () => {
  const weatherJson = {
    current: { temperature_2m: 31.2, apparent_temperature: 36.4, weather_code: 2 },
    daily: {
      weather_code: [61, 3],
      temperature_2m_max: [33.1, 30],
      temperature_2m_min: [25, 24.5],
      precipitation_probability_max: [80, 20],
    },
  };

  it('weatherText / distance helpers', () => {
    expect(weatherText(0)).toBe('ท้องฟ้าแจ่มใส');
    expect(weatherText(95)).toBe('พายุฝนฟ้าคะนอง');
    expect(distanceMeters({ lat: 13.75, lon: 100.5 }, { lat: 13.75, lon: 100.5 })).toBeCloseTo(0);
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeGreaterThan(110_000);
    expect(spokenDistance(340)).toBe('340 เมตร');
    expect(spokenDistance(1250)).toBe('1.3 กิโลเมตร');
  });

  it('summarizeWeather: วันนี้ (มีสภาพปัจจุบัน + พกร่ม) และพรุ่งนี้', () => {
    const today = summarizeWeather(weatherJson, false, null);
    expect(today).toContain('31 องศา');
    expect(today).toContain('รู้สึกเหมือน 36');
    expect(today).toContain('พกร่ม');
    const tomorrow = summarizeWeather(weatherJson, true, 'เชียงใหม่');
    expect(tomorrow).toContain('อากาศที่เชียงใหม่');
    expect(tomorrow).toContain('พรุ่งนี้มีเมฆมาก');
    expect(() => summarizeWeather({}, false, null)).toThrow();
  });

  it('placeNameIn', () => {
    expect(placeNameIn('อากาศที่เชียงใหม่เป็นไง')).toBe('เชียงใหม่');
    expect(placeNameIn('ฝนจะตกที่ภูเก็ตไหมครับ')).toBe('ภูเก็ต');
    expect(placeNameIn('วันนี้อากาศเป็นไง')).toBeNull();
    expect(placeNameIn('อากาศวันนี้')).toBeNull();
    expect(placeNameIn('พรุ่งนี้ฝนตกที่ภูเก็ต')).toBe('ภูเก็ต');
  });

  it('nearestPlaces: เรียงตามระยะ ตัดตาม limit ใช้ชื่อไทยก่อน', () => {
    const origin = { lat: 13.75, lon: 100.5 };
    const data = {
      elements: [
        { lat: 13.76, lon: 100.5, tags: { name: 'Far Cafe' } },
        { lat: 13.751, lon: 100.5, tags: { 'name:th': 'คาเฟ่ใกล้', name: 'Near Cafe' } },
        { lat: 13.7505, lon: 100.5 },
        { tags: { name: 'no coords' } },
      ],
    };
    const places = nearestPlaces(data, origin, 2);
    expect(places.map((p) => p.name)).toEqual(['(ไม่มีชื่อ)', 'คาเฟ่ใกล้']);
  });

  const makeApi = (override: Partial<PlaceApi> = {}) => {
    const urls: string[] = [];
    const api: PlaceApi = {
      position: async () => ({ lat: 13.75, lon: 100.5 }),
      reverse: async () => 'ถนนสุขุมวิท กรุงเทพ',
      getJson: async (url) => {
        urls.push(url);
        if (url.includes('geocoding')) return { results: [{ latitude: 18.79, longitude: 98.98 }] };
        if (url.includes('overpass'))
          return { elements: [{ lat: 13.751, lon: 100.5, tags: { name: 'ร้านกาแฟ A' } }] };
        return weatherJson;
      },
      ...override,
    };
    return { api, urls };
  };

  it('อากาศ: ตำแหน่งปัจจุบัน / ชื่อสถานที่ (geocode) / พรุ่งนี้', async () => {
    const { api, urls } = makeApi();
    const agent = createPlaceAgent({ api });
    const here = await agent.run({
      text: 'วันนี้อากาศเป็นไง',
      commandText: '',
      capabilityId: 'place.weather',
      persona: 1,
    });
    expect(here.reply).toContain('องศา');
    expect(urls[0]).toContain('latitude=13.750');
    const named = await agent.run({
      text: 'อากาศที่เชียงใหม่',
      commandText: '',
      capabilityId: 'place.weather',
      persona: 1,
    });
    expect(named.reply).toContain('อากาศที่เชียงใหม่');
    expect(urls.some((u) => u.includes('geocoding-api'))).toBe(true);
    const tomorrow = await agent.run({
      text: 'พรุ่งนี้ฝนจะตกไหม',
      commandText: '',
      capabilityId: 'place.weather',
      persona: 1,
    });
    expect(tomorrow.reply).toContain('พรุ่งนี้');
  });

  it('ใกล้ฉัน: สร้าง query ตามหมวด · ไม่พบ · ไม่ได้สิทธิ์ · ไม่รู้หมวด', async () => {
    const { api, urls } = makeApi();
    const agent = createPlaceAgent({ api });
    const r = await agent.run({
      text: 'หาร้านกาแฟใกล้ฉัน',
      commandText: '',
      capabilityId: 'place.nearby',
      persona: 1,
    });
    expect(r.reply).toContain('ร้านกาแฟ A ห่าง');
    expect(urls.at(-1)).toContain('overpass');
    const none = createPlaceAgent({
      api: makeApi({ getJson: async () => ({ elements: [] }) }).api,
    });
    expect(
      (
        await none.run({
          text: 'ปั๊มน้ำมันใกล้ๆ',
          commandText: '',
          capabilityId: 'place.nearby',
          persona: 1,
        })
      ).reply,
    ).toContain('ไม่พบ');
    const denied = createPlaceAgent({ api: makeApi({ position: async () => null }).api });
    expect(
      (
        await denied.run({
          text: 'อากาศวันนี้',
          commandText: '',
          capabilityId: 'place.weather',
          persona: 1,
        })
      ).reply,
    ).toContain('ยังไม่ได้อนุญาต');
    expect(
      (
        await agent.run({
          text: 'อะไรสักอย่างใกล้ๆ',
          commandText: '',
          capabilityId: 'place.nearby',
          persona: 1,
        })
      ).reply,
    ).toContain('อยากหาสถานที่แบบไหน');
  });

  it('ฉันอยู่ที่ไหน → reverse geocode', async () => {
    const agent = createPlaceAgent({ api: makeApi().api });
    expect(
      (
        await agent.run({
          text: 'ฉันอยู่ที่ไหน',
          commandText: '',
          capabilityId: 'place.where',
          persona: 1,
        })
      ).reply,
    ).toContain('ถนนสุขุมวิท');
  });
});

describe('image + vision + web search agents', () => {
  it('สร้างรูป: เรียกโมเดล บันทึกไฟล์ แนบ imageUri', async () => {
    const prompts: string[] = [];
    const agent = createImageAgent({
      generate: async (p) => {
        prompts.push(p);
        return { data: 'AAAA', mimeType: 'image/png' };
      },
      save: async () => 'file:///docs/atom-image-1.png',
    });
    const r = await agent.run({
      text: 'x',
      commandText: 'แมวใส่หมวก',
      capabilityId: 'image.generate',
      persona: 1,
    });
    expect(prompts).toEqual(['แมวใส่หมวก']);
    expect(r).toEqual({ reply: 'วาดให้แล้วครับ', imageUri: 'file:///docs/atom-image-1.png' });
  });

  it('กล้อง: ยกเลิก → ไม่เรียกโมเดล · ถ่ายแล้วส่งคำถามไปด้วย', async () => {
    const asked: string[] = [];
    const describe = async (_p: unknown, q: string) => {
      asked.push(q);
      return 'เป็นป้ายห้ามจอด';
    };
    const cancelled = createVisionAgent({ capture: async () => null, describe });
    expect(
      (await cancelled.run({ text: 'x', commandText: '', capabilityId: 'vision.look', persona: 1 }))
        .reply,
    ).toContain('ยกเลิก');
    expect(asked).toEqual([]);
    const agent = createVisionAgent({
      capture: async () => ({ base64: 'QQ==', mimeType: 'image/jpeg' }),
      describe,
    });
    const r = await agent.run({
      text: 'x',
      commandText: 'อ่านป้ายนี้',
      capabilityId: 'vision.look',
      persona: 1,
    });
    expect(r.reply).toBe('เป็นป้ายห้ามจอด');
    expect(asked[0]).toContain('อ่านป้ายนี้');
  });

  it('ค้นเว็บ: ตอบพร้อมแหล่งอ้างอิง 2 แห่ง ไม่มี URL', async () => {
    const agent = createWebSearchAgent(async () => ({
      text: 'ทองคำแท่งขายออก 40,000 บาท',
      sources: ['ฮั่วเซ่งเฮง', 'ข่าวสด', 'อื่น'],
    }));
    const r = await agent.run({
      text: 'x',
      commandText: 'ราคาทองวันนี้',
      capabilityId: 'web.search',
      persona: 1,
    });
    expect(r.reply).toBe('ทองคำแท่งขายออก 40,000 บาท (อ้างอิง ฮั่วเซ่งเฮง, ข่าวสด)');
    expect(r.reply).not.toMatch(/https?:/);
  });
});

describe('reminder agent', () => {
  const makeNotifications = (granted = true) => {
    const items: ScheduledItem[] = [];
    let seq = 0;
    const api: NotificationsApi = {
      ensurePermission: async () => granted,
      scheduleAt: async (at, title, body, kind) => {
        items.push({ id: `n${++seq}`, title, body, at, kind });
        return `n${seq}`;
      },
      scheduleDaily: async (hour, minute, title, body, kind) => {
        items.push({ id: `n${++seq}`, title, body, daily: { hour, minute }, kind });
        return `n${seq}`;
      },
      cancel: async (id) =>
        void items.splice(
          items.findIndex((i) => i.id === id),
          1,
        ),
      list: async () => [...items],
    };
    return { api, items };
  };
  const input = (commandText: string, capabilityId: string) => ({
    text: commandText,
    commandText,
    capabilityId,
    persona: 1 as const,
  });

  it('ตั้งเตือนครั้งเดียว + ดูรายการ', async () => {
    const { api, items } = makeNotifications();
    const llm = llmReturning({ text: 'โทรหาหมอ', at: '2026-10-22T09:00:00+07:00' });
    const agent = createReminderAgent({ notifications: api, llm, now: () => NOW });
    const r = await agent.run(input('โทรหาหมอพรุ่งนี้ 9 โมง', 'reminder.set'));
    expect(r.reply).toContain('โทรหาหมอ');
    expect(items[0]).toMatchObject({ kind: 'reminder', body: 'โทรหาหมอ' });
    expect((await agent.run(input('', 'reminder.list'))).reply).toContain('โทรหาหมอ');
  });

  it('เวลาที่ผ่านไปแล้ว → error ไทย · ไม่ได้สิทธิ์แจ้งเตือน', async () => {
    const { api } = makeNotifications();
    const agent = createReminderAgent({
      notifications: api,
      llm: llmReturning({ text: 'x', at: '2026-10-21T10:00:00+07:00' }),
      now: () => NOW,
    });
    await expect(agent.run(input('x', 'reminder.set'))).rejects.toThrow('ผ่านไปแล้ว');
    const denied = createReminderAgent({
      notifications: makeNotifications(false).api,
      now: () => NOW,
    });
    expect((await denied.run(input('x', 'reminder.set'))).reply).toContain('ยังไม่ได้อนุญาต');
  });

  it('สรุปเช้า: เปิด (ค่าเริ่มต้น 07:00) แทนของเดิม · ปิด · สรุปตอนนี้', async () => {
    const { api, items } = makeNotifications();
    const agent = createReminderAgent({
      notifications: api,
      now: () => NOW,
      briefing: async () => 'สรุป: ไม่มีนัด',
    });
    expect((await agent.run(input('', 'briefing.on'))).reply).toContain('07:00');
    expect((await agent.run(input('8 โมงครึ่ง', 'briefing.on'))).reply).toContain('08:30');
    expect(items.filter((i) => i.kind === 'briefing')).toHaveLength(1); // ตัวเก่าถูกแทน
    expect((await agent.run(input('', 'reminder.list'))).reply).toContain('สรุปเช้าทุกวัน 08:30');
    expect((await agent.run(input('', 'briefing.off'))).reply).toContain('ปิดสรุปเช้า');
    expect((await agent.run(input('', 'briefing.off'))).reply).toContain('ยังไม่ได้เปิด');
    expect((await agent.run(input('', 'briefing.now'))).reply).toBe('สรุป: ไม่มีนัด');
  });
});

describe('home assistant agent', () => {
  const entities: HaEntity[] = [
    { entityId: 'light.living_room', name: 'ไฟห้องนั่งเล่น', state: 'off' },
    { entityId: 'light.bedroom', name: 'ไฟห้องนอน', state: 'on' },
    { entityId: 'cover.curtain', name: 'ม่านห้องนั่งเล่น', state: 'closed' },
    { entityId: 'lock.front_door', name: 'ประตูหน้า', state: 'locked' },
    { entityId: 'alarm_control_panel.home', name: 'สัญญาณกันขโมย', state: 'armed_away' },
    { entityId: 'sensor.temp', name: 'อุณหภูมิ', state: '28' },
  ];
  const makeClient = () => {
    const calls: [string, string, string][] = [];
    const client: HaClient = {
      states: async () => entities,
      callService: async (d, s, e) => void calls.push([d, s, e]),
    };
    return { client, calls };
  };
  const input = (text: string) => ({
    text,
    commandText: text,
    capabilityId: 'home.control',
    persona: 1 as const,
  });

  it('allow-list: ไม่รวมประตูล็อก/สัญญาณกันขโมย/เซนเซอร์', () => {
    expect(controllable(entities).map((e) => e.entityId)).toEqual([
      'light.living_room',
      'light.bedroom',
      'cover.curtain',
    ]);
    expect(Object.keys(ALLOWED_SERVICES)).not.toContain('lock');
    expect(Object.keys(ALLOWED_SERVICES)).not.toContain('alarm_control_panel');
    expect(Object.values(ALLOWED_SERVICES).flat()).not.toContain('unlock');
  });

  it('rankEntities: ชื่อที่ซ้อนกับคำสั่งขึ้นก่อน และตัดตาม limit', () => {
    expect(rankEntities(controllable(entities), 'เปิด ไฟห้องนอน')[0]?.entityId).toBe(
      'light.bedroom',
    );
    expect(rankEntities(controllable(entities), 'x', 1)).toHaveLength(1);
  });

  it('สั่งเปิดไฟ → เรียก service ที่ถูกต้อง', async () => {
    const { client, calls } = makeClient();
    const agent = createHomeAgent({
      client: async () => client,
      llm: llmReturning({ action: 'control', entity_id: 'light.living_room', service: 'turn_on' }),
    });
    const r = await agent.run(input('เปิดไฟห้องนั่งเล่น'));
    expect(calls).toEqual([['light', 'turn_on', 'light.living_room']]);
    expect(r.reply).toBe('เปิด ไฟห้องนั่งเล่น ให้แล้วครับ');
  });

  it('ถามสถานะ → ไม่เรียก service', async () => {
    const { client, calls } = makeClient();
    const agent = createHomeAgent({
      client: async () => client,
      llm: llmReturning({ action: 'query', entity_id: 'light.bedroom', service: null }),
    });
    expect((await agent.run(input('ไฟห้องนอนเปิดอยู่ไหม'))).reply).toBe('ไฟห้องนอน เปิดอยู่ครับ');
    expect(calls).toEqual([]);
  });

  it('LLM เลือก entity นอกรายการ (ประตู) หรือ service นอก allow-list → ปฏิเสธ ไม่เรียก', async () => {
    const { client, calls } = makeClient();
    const door = createHomeAgent({
      client: async () => client,
      llm: llmReturning({ action: 'control', entity_id: 'lock.front_door', service: 'unlock' }),
    });
    expect((await door.run(input('ปลดล็อกประตู'))).reply).toContain('ไม่พบอุปกรณ์');
    const badService = createHomeAgent({
      client: async () => client,
      llm: llmReturning({ action: 'control', entity_id: 'light.bedroom', service: 'set_hacked' }),
    });
    await expect(badService.run(input('ทำอะไรแปลก'))).rejects.toThrow('ไม่ได้');
    expect(calls).toEqual([]);
  });

  it('ยังไม่ตั้งค่า Home Assistant → บอกทางตั้งค่า', async () => {
    const agent = createHomeAgent({ client: async () => null });
    expect((await agent.run(input('เปิดไฟ'))).reply).toContain('ยังไม่ได้ตั้งค่า Home Assistant');
  });
});

describe('custom assistants', () => {
  it('store: เพิ่ม/ซ้ำ/ชื่อสงวน/ลบ/จำกัดจำนวน', async () => {
    const store = new AssistantStore('test.assistants');
    await store.add({ name: 'นักแปล', prompt: 'แปลภาษา' });
    expect(store.find('นักแปล')?.prompt).toBe('แปลภาษา');
    await expect(store.add({ name: 'นักแปล', prompt: 'x' })).rejects.toThrow('มีผู้ช่วยชื่อ');
    await expect(store.add({ name: 'อะตอม', prompt: 'x' })).rejects.toThrow('ชื่อผู้ช่วยหลัก');
    await expect(store.add({ name: '', prompt: 'x' })).rejects.toThrow('1–24');
    expect(await store.remove('นักแปล')).toBe(true);
    expect(await store.remove('นักแปล')).toBe(false);
    for (let i = 0; i < 12; i++) await store.add({ name: `ผช${i}`, prompt: 'p' });
    await expect(store.add({ name: 'เกิน', prompt: 'p' })).rejects.toThrow('สูงสุด');
  });

  it('store: โหลดซ้ำจาก storage ได้ข้อมูลเดิม', async () => {
    const a = new AssistantStore('test.assistants.persist');
    await a.add({ name: 'พ่อครัว', prompt: 'ให้สูตร' });
    const b = new AssistantStore('test.assistants.persist');
    await b.load();
    expect(b.list().map((x) => x.name)).toEqual(['พ่อครัว']);
  });

  it('invokePatterns: จับชื่อที่มีอยู่จริง (รวมอักขระพิเศษ) และไม่จับชื่ออื่น', () => {
    expect(invokePatterns([])).toEqual([]);
    const patterns = invokePatterns(['นักแปล', 'C++ guru']);
    const hit = (t: string) => patterns.some((p) => p.test(t));
    expect(hit('ให้นักแปลช่วยแปลว่า สวัสดี')).toBe(true);
    expect(hit('นักแปล: hello world')).toBe(true);
    expect(hit('ถาม C++ guru ว่า pointer คืออะไร')).toBe(true);
    expect(hit('ให้หมอช่วยดูหน่อย')).toBe(false);
    expect(hit('นักแปลคืออาชีพอะไร')).toBe(false);
  });

  it('agent: สร้าง (LLM ร่าง prompt) → เรียกใช้ด้วยชื่อ → รายชื่อ → ลบ · capability ใหม่โผล่ทันที', async () => {
    const store = new AssistantStore('test.assistants.agent');
    const seen: string[] = [];
    const agent = createCustomAssistantsAgent({
      store,
      llm: llmReturning({ name: 'นักแปล', prompt: 'คุณคือนักแปลไทย-อังกฤษ แปลสุภาพ' }),
      respond: async (prompt, req) => {
        seen.push(`${prompt}|${req}`);
        return 'Good morning';
      },
    });
    expect(agent.capabilities.map((c) => c.id)).not.toContain('assistant.use');
    const created = await agent.run({
      text: 'x',
      commandText: 'ชื่อ นักแปล แปลไทยเป็นอังกฤษ',
      capabilityId: 'assistant.create',
      persona: 1,
    });
    expect(created.reply).toContain('นักแปล');
    expect(agent.capabilities.map((c) => c.id)).toContain('assistant.use');
    const used = await agent.run({
      text: 'ให้นักแปลช่วยแปลว่า สวัสดีตอนเช้า',
      commandText: 'แปลว่า สวัสดีตอนเช้า',
      capabilityId: 'assistant.use',
      persona: 1,
    });
    expect(used.reply).toBe('Good morning');
    expect(seen[0]).toContain('นักแปลไทย-อังกฤษ');
    expect(
      (await agent.run({ text: 'x', commandText: '', capabilityId: 'assistant.list', persona: 1 }))
        .reply,
    ).toContain('นักแปล');
    expect(
      (
        await agent.run({
          text: 'x',
          commandText: 'นักแปล',
          capabilityId: 'assistant.delete',
          persona: 1,
        })
      ).reply,
    ).toContain('ลบ');
    expect(agent.capabilities.map((c) => c.id)).not.toContain('assistant.use');
  });
});

describe('routing: AgentClassifier กับ agent ทั้งหมด', () => {
  const registry = new AgentRegistry();
  registerAssistantAgents(registry);
  const classifier = new AgentClassifier(registry);
  const route = (text: string) => {
    const r = classifier.check(text);
    return r?.intent === 'agent' ? `${r.entities.agentId}:${r.entities.capabilityId}` : null;
  };

  it('ลงทะเบียนครบ 10 agent และซ้ำไม่เพิ่ม', () => {
    expect(registry.list().length).toBe(10);
    expect(registerAssistantAgents(registry)).toBe(0);
  });

  it.each([
    ['ตั้งปลุก 6 โมงครึ่ง', 'clock:alarm.set'],
    ['ปลุกฉันตอนตี 5', 'clock:alarm.set'],
    ['ตั้งเวลา 10 นาที', 'clock:timer.set'],
    ['จับเวลา 5 นาที', 'clock:timer.set'],
    ['อ่านคลิปบอร์ด', 'clock:clipboard.read'],
    ['โทรหาแม่', 'contacts:contact.call'],
    ['ส่งข้อความหาแม่ ว่า ถึงบ้านแล้ว', 'contacts:contact.sms'],
    ['เบอร์แม่', 'contacts:contact.lookup'],
    ['เตือนให้โทรหาหมอพรุ่งนี้ 9 โมง', 'reminder:reminder.set'],
    ['ดูรายการเตือน', 'reminder:reminder.list'],
    ['เปิดสรุปเช้า 7 โมง', 'reminder:briefing.on'],
    ['ปิดสรุปเช้า', 'reminder:briefing.off'],
    ['สรุปวันนี้ให้หน่อย', 'reminder:briefing.now'],
    ['ดูตารางนัดพรุ่งนี้', 'calendar:calendar.agenda'],
    ['วันนี้มีนัดอะไรบ้าง', 'calendar:calendar.agenda'],
    ['นัดหมอพรุ่งนี้ 10 โมง', 'calendar:calendar.create'],
    ['ลงปฏิทิน ประชุมทีมวันศุกร์บ่าย 2', 'calendar:calendar.create'],
    ['เปิดไฟห้องนั่งเล่น', 'home-assistant:home.control'],
    ['ปิดพัดลม', 'home-assistant:home.control'],
    ['ไฟห้องนอนเปิดอยู่ไหม', 'home-assistant:home.control'],
    ['สร้างผู้ช่วยชื่อ นักแปล ที่แปลไทยเป็นอังกฤษ', 'custom-assistants:assistant.create'],
    ['มีผู้ช่วยอะไรบ้าง', 'custom-assistants:assistant.list'],
    ['ฉันอยู่ที่ไหน', 'place:place.where'],
    ['หาร้านกาแฟใกล้ฉัน', 'place:place.nearby'],
    ['ค้นหาร้านยาแถวนี้', 'place:place.nearby'],
    ['วันนี้อากาศเป็นไง', 'place:place.weather'],
    ['พรุ่งนี้ฝนจะตกไหม', 'place:place.weather'],
    ['วาดรูปแมวใส่หมวก', 'image:image.generate'],
    ['สร้างภาพโลโก้ร้านกาแฟ', 'image:image.generate'],
    ['ดูป้ายนี้ให้หน่อย', 'vision:vision.look'],
    ['นี่คืออะไร', 'vision:vision.look'],
    ['ค้นเว็บ ราคาทองวันนี้', 'web-search:web.search'],
    ['ข่าวล่าสุดเรื่องน้ำท่วม', 'web-search:web.search'],
  ])('"%s" → %s', (text, expected) => expect(route(text)).toBe(expected));

  it.each([
    'สวัสดีครับ',
    'วันนี้เหนื่อยจัง',
    'ช่วยอธิบายว่าทำไมท้องฟ้าถึงเป็นสีฟ้า',
    'ช่วยเขียนบทความเรื่องอากาศเปลี่ยนแปลง',
    'เล่าเรื่องตลกให้ฟังหน่อย',
    'ไฟฉายเปิดยังไง',
    'เปิดไฟฉาย',
    'ดูหนังเรื่องอะไรดี',
    'แมวชอบกินอะไร',
    'ฉันชอบวาดรูปมาก',
    'ปลุกใจหน่อยสิ',
    'นัดนี้สำคัญไหม',
    'ตารางสูตรคูณ',
    'โทรศัพท์เครื่องนี้ราคาเท่าไหร่',
  ])('ประโยคคุยปกติ "%s" ไม่ถูกแย่ง', (text) => expect(route(text)).toBeNull());
});

describe('shared', () => {
  it('parseJsonLoose: ทน markdown fence และข้อความนำ', () => {
    expect(parseJsonLoose('นี่ครับ ```json\n{"a":1}\n``` จบ')).toEqual({ a: 1 });
    expect(parseJsonLoose('ไม่มี json')).toBeNull();
    expect(parseJsonLoose('[1,2]')).toBeNull();
    expect(parseJsonLoose('{broken')).toBeNull();
  });
});
