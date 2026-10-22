/**
 * @file Test Suite for System Tools & SystemDeviceAgent
 */

import { Linking } from 'react-native';

import {
  getWeatherCondition,
  fetchWeather,
  listEventsForPeriod,
  createEvent,
  scheduleReminder,
  setDeviceAlarm,
  openDeviceSettings,
  openSpotifySearch,
} from '../modules/system';
import {
  createSystemDeviceAgent,
  SYSTEM_AGENT_ID,
} from '../modules/agents/system-device-agent';

// Mock expo modules
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 13.7563, longitude: 100.5018 },
  }),
  Accuracy: { Balanced: 3 },
}));

jest.mock('expo-calendar', () => ({
  requestCalendarPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCalendarsAsync: jest.fn().mockResolvedValue([
    { id: 'cal-1', isPrimary: true, allowsModifications: true },
  ]),
  getEventsAsync: jest.fn().mockResolvedValue([
    {
      id: 'event-1',
      title: 'ประชุมทีม',
      startDate: new Date('2026-10-22T10:00:00Z'),
      endDate: new Date('2026-10-22T11:00:00Z'),
      location: 'ห้องประชุม A',
    },
  ]),
  createEventAsync: jest.fn().mockResolvedValue('event-new-1'),
  EntityTypes: { EVENT: 'event' },
  SourceType: { LOCAL: 'local' },
}));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-1'),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  AndroidNotificationPriority: { HIGH: 'high' },
}));

jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
}));

jest.mock('expo-brightness', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setBrightnessAsync: jest.fn().mockResolvedValue(undefined),
}));

describe('System Tools Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as any);
  });

  describe('Weather Tool', () => {
    test('getWeatherCondition maps WMO codes correctly', () => {
      expect(getWeatherCondition(0)).toBe('ท้องฟ้าแจ่มใส');
      expect(getWeatherCondition(2)).toBe('มีเมฆบางส่วน');
      expect(getWeatherCondition(3)).toBe('เมฆครึ้ม');
      expect(getWeatherCondition(45)).toBe('มีหมอก');
      expect(getWeatherCondition(61)).toBe('ฝนตก');
      expect(getWeatherCondition(95)).toBe('พายุฝนฟ้าคะนอง');
      expect(getWeatherCondition(999)).toBe('สภาพอากาศแปรปรวน');
    });

    test('fetchWeather queries Open-Meteo and returns formatted WeatherData', async () => {
      const mockResponse = {
        current: {
          temperature_2m: 31.4,
          relative_humidity_2m: 65,
          weather_code: 0,
          wind_speed_10m: 12.3,
        },
        daily: {
          time: ['2026-10-22', '2026-10-23'],
          temperature_2m_max: [33, 34],
          temperature_2m_min: [25, 26],
          weather_code: [0, 1],
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const weather = await fetchWeather(13.75, 100.5);
      expect(weather.temperature).toBe(31);
      expect(weather.condition).toBe('ท้องฟ้าแจ่มใส');
      expect(weather.humidity).toBe(65);
      expect(weather.forecast?.length).toBe(2);
    });
  });

  describe('Calendar Tool', () => {
    test('listEventsForPeriod returns mapped events', async () => {
      const events = await listEventsForPeriod(new Date(), new Date());
      expect(events.length).toBe(1);
      expect(events[0]?.title).toBe('ประชุมทีม');
      expect(events[0]?.location).toBe('ห้องประชุม A');
    });

    test('createEvent calls Calendar.createEventAsync', async () => {
      const id = await createEvent({
        title: 'นัดพบลูกค้า',
        startDate: new Date(),
        endDate: new Date(),
      });
      expect(id).toBe('event-new-1');
    });
  });

  describe('Reminder & Alarm Tool', () => {
    test('scheduleReminder schedules notification', async () => {
      const notifId = await scheduleReminder('เตือนกินยา', new Date(Date.now() + 60000));
      expect(notifId).toBe('notif-1');
    });

    test('setDeviceAlarm triggers IntentLauncher on Android', async () => {
      const res = await setDeviceAlarm({ hour: 6, minutes: 30, message: 'ตื่นเช้า' });
      expect(res.success).toBe(true);
      expect(res.note).toContain('06:30');
    });
  });

  describe('Device Control & Spotify Tool', () => {
    test('openDeviceSettings calls IntentLauncher for target', async () => {
      const res = await openDeviceSettings('wifi');
      expect(res.success).toBe(true);
    });

    test('openSpotifySearch attempts spotify: URI and falls back to web', async () => {
      const res = await openSpotifySearch('bodyslam');
      expect(res).toBe(true);
    });
  });

  describe('SystemDeviceAgent Integration', () => {
    const agent = createSystemDeviceAgent();

    test('has valid metadata and capabilities', () => {
      expect(agent.id).toBe(SYSTEM_AGENT_ID);
      expect(agent.capabilities.length).toBeGreaterThanOrEqual(6);
      expect(agent.capabilities.map((c) => c.id)).toContain('system.weather');
      expect(agent.capabilities.map((c) => c.id)).toContain('system.alarm');
      expect(agent.capabilities.map((c) => c.id)).toContain('system.calendar');
      expect(agent.capabilities.map((c) => c.id)).toContain('system.reminder');
      expect(agent.capabilities.map((c) => c.id)).toContain('system.settings');
      expect(agent.capabilities.map((c) => c.id)).toContain('system.spotify');
    });

    test('runs system.weather and returns reply with visualCard', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current: { temperature_2m: 29, weather_code: 1, wind_speed_10m: 10 },
          daily: { time: [] },
        }),
      } as any);

      const res = await agent.run({
        text: 'อากาศวันนี้เป็นยังไง',
        commandText: 'วันนี้',
        capabilityId: 'system.weather',
        persona: 1,
      });

      expect(res.reply).toContain('29°C');
      expect(res.visualCard).toBeDefined();
      expect(res.visualCard?.type).toBe('weather');
    });

    test('runs system.alarm and returns reply with reminder visualCard', async () => {
      const res = await agent.run({
        text: 'ตั้งปลุก 06:45',
        commandText: '06:45',
        capabilityId: 'system.alarm',
        persona: 1,
      });

      expect(res.reply).toContain('06:45');
      expect(res.visualCard?.type).toBe('reminder');
    });

    test('runs system.calendar and returns reply with calendar visualCard', async () => {
      const res = await agent.run({
        text: 'ตารางงานวันนี้',
        commandText: 'วันนี้',
        capabilityId: 'system.calendar',
        persona: 1,
      });

      expect(res.reply).toContain('นัดหมาย');
      expect(res.visualCard?.type).toBe('calendar');
    });

    test('runs system.settings and opens wifi settings', async () => {
      const res = await agent.run({
        text: 'เปิดการตั้งค่า wifi',
        commandText: 'wifi',
        capabilityId: 'system.settings',
        persona: 1,
      });

      expect(res.reply).toContain('wifi');
      expect(res.visualCard?.type).toBe('device');
    });

    test('runs system.spotify and prepares player', async () => {
      const res = await agent.run({
        text: 'เล่นเพลง rock',
        commandText: 'rock',
        capabilityId: 'system.spotify',
        persona: 1,
      });

      expect(res.reply).toContain('Spotify');
      expect(res.visualCard?.type).toBe('media');
    });
  });
});
