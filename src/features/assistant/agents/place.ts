/**
 * @file ตำแหน่ง / อากาศ / ร้านใกล้ฉัน — ใช้ของสำเร็จรูปทั้งหมด ไม่ต้องมี API key:
 * ตำแหน่งจาก GPS ของเครื่อง (expo-location) · อากาศจาก Open-Meteo · ค้นสถานที่จาก OpenStreetMap (Overpass)
 * พิกัดถูกส่งไปเฉพาะตอนผู้ใช้ถามเรื่องนั้น ๆ และไม่ถูกเก็บ
 */

import type { AgentDefinition } from '../../../core/agents/types';
import { requestJson } from '../../../core/http/request';
import { isRecord } from '../../../core/types/guards';
import { AssistantError, loadNative } from '../shared/errors';

export const PLACE_AGENT_ID = 'place';

export interface Coords {
  lat: number;
  lon: number;
}

export interface PlaceApi {
  /** null = ไม่ได้สิทธิ์ตำแหน่ง */
  position(): Promise<Coords | null>;
  reverse(c: Coords): Promise<string | null>;
  getJson(
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<unknown>;
}

function defaultApi(): PlaceApi {
  const lib = () =>
    loadNative(
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
      () => require('expo-location') as typeof import('expo-location'),
      'ตำแหน่ง',
    );
  return {
    async position() {
      const Location = lib();
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return null;
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
      const p =
        last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      return { lat: p.coords.latitude, lon: p.coords.longitude };
    },
    async reverse(c) {
      const [a] = await lib().reverseGeocodeAsync({ latitude: c.lat, longitude: c.lon });
      if (!a) return null;
      return [a.name, a.street, a.subregion ?? a.district, a.city, a.region]
        .filter(Boolean)
        .slice(0, 4)
        .join(' ');
    },
    getJson: (url, init) =>
      requestJson<unknown>('assistant', url, { timeoutMs: 20_000, ...(init ?? {}) }),
  };
}

/** WMO weather code → ไทย */
export function weatherText(code: number): string {
  if (code === 0) return 'ท้องฟ้าแจ่มใส';
  if (code <= 2) return 'มีเมฆบางส่วน';
  if (code === 3) return 'มีเมฆมาก';
  if (code === 45 || code === 48) return 'มีหมอก';
  if (code >= 51 && code <= 57) return 'ฝนปรอย';
  if (code >= 61 && code <= 67) return 'ฝนตก';
  if (code >= 71 && code <= 77) return 'มีหิมะ';
  if (code >= 80 && code <= 82) return 'ฝนตกเป็นช่วง ๆ';
  if (code === 85 || code === 86) return 'หิมะตกเป็นช่วง ๆ';
  if (code >= 95) return 'พายุฝนฟ้าคะนอง';
  return 'อากาศแปรปรวน';
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** สรุปอากาศจากผลของ Open-Meteo (current + daily 2 วัน) */
export function summarizeWeather(data: unknown, tomorrow: boolean, where: string | null): string {
  if (!isRecord(data) || !isRecord(data.daily))
    throw new AssistantError('อ่านข้อมูลอากาศไม่ได้ครับ');
  const daily = data.daily;
  const i = tomorrow ? 1 : 0;
  const code = n(arr(daily.weather_code)[i]);
  const max = n(arr(daily.temperature_2m_max)[i]);
  const min = n(arr(daily.temperature_2m_min)[i]);
  const pop = n(arr(daily.precipitation_probability_max)[i]);
  const head = where ? `อากาศที่${where}` : 'อากาศ';
  const parts: string[] = [];
  if (!tomorrow && isRecord(data.current)) {
    const t = n(data.current.temperature_2m);
    const feels = n(data.current.apparent_temperature);
    const cc = n(data.current.weather_code);
    if (t !== null) {
      parts.push(
        `ตอนนี้${cc !== null ? weatherText(cc) : ''} ${Math.round(t)} องศา` +
          (feels !== null && Math.abs(feels - t) >= 2
            ? ` (รู้สึกเหมือน ${Math.round(feels)})`
            : ''),
      );
    }
  }
  const dayWord = tomorrow ? 'พรุ่งนี้' : 'วันนี้';
  const range =
    max !== null && min !== null ? ` สูงสุด ${Math.round(max)} ต่ำสุด ${Math.round(min)} องศา` : '';
  parts.push(`${dayWord}${code !== null ? weatherText(code) : ''}${range}`);
  if (pop !== null) parts.push(`โอกาสฝน ${Math.round(pop)}%${pop >= 60 ? ' พกร่มด้วยนะครับ' : ''}`);
  return `${head}: ${parts.join(' · ')}`;
}

/** หมวดสถานที่ → OSM tag */
export const PLACE_KINDS: { pattern: RegExp; label: string; tag: string }[] = [
  { pattern: /ร้านกาแฟ|คาเฟ่|cafe/i, label: 'ร้านกาแฟ', tag: '"amenity"="cafe"' },
  { pattern: /ร้านอาหาร|ร้านข้าว/, label: 'ร้านอาหาร', tag: '"amenity"="restaurant"' },
  { pattern: /ร้านยา/, label: 'ร้านยา', tag: '"amenity"="pharmacy"' },
  { pattern: /โรงพยาบาล/, label: 'โรงพยาบาล', tag: '"amenity"="hospital"' },
  { pattern: /ปั๊ม/, label: 'ปั๊มน้ำมัน', tag: '"amenity"="fuel"' },
  { pattern: /เอทีเอ็ม|atm|ตู้เงิน/i, label: 'ตู้เอทีเอ็ม', tag: '"amenity"="atm"' },
  { pattern: /ธนาคาร/, label: 'ธนาคาร', tag: '"amenity"="bank"' },
  { pattern: /เซเว่น|สะดวกซื้อ|มินิมาร์ท/, label: 'ร้านสะดวกซื้อ', tag: '"shop"="convenience"' },
  { pattern: /ห้องน้ำ/, label: 'ห้องน้ำสาธารณะ', tag: '"amenity"="toilets"' },
];

export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function spokenDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} เมตร` : `${(m / 1000).toFixed(1)} กิโลเมตร`;
}

/** ผล Overpass → รายการใกล้สุด (ชื่อ + ระยะ) */
export function nearestPlaces(
  data: unknown,
  origin: Coords,
  limit = 3,
): { name: string; meters: number }[] {
  if (!isRecord(data)) return [];
  const out: { name: string; meters: number }[] = [];
  for (const el of arr(data.elements)) {
    if (!isRecord(el)) continue;
    const lat = n(el.lat);
    const lon = n(el.lon);
    if (lat === null || lon === null) continue;
    const tags = isRecord(el.tags) ? el.tags : {};
    const name = [tags['name:th'], tags.name, tags['name:en'], tags.brand].find(
      (t) => typeof t === 'string' && t,
    ) as string | undefined;
    out.push({ name: name ?? '(ไม่มีชื่อ)', meters: distanceMeters(origin, { lat, lon }) });
  }
  return out.sort((a, b) => a.meters - b.meters).slice(0, limit);
}

/** คำท้ายประโยค/คำบอกเวลาที่ต้องตัดออกจากชื่อสถานที่ (ภาษาไทยไม่มีช่องว่างคั่นคำ) */
const TRAILING =
  /(?:เป็นยังไงบ้าง|เป็นยังไง|เป็นไงบ้าง|เป็นไง|ไหมครับ|ไหมคะ|หรือเปล่า|หรือไม่|ไหม|บ้างไหม|บ้าง|หน่อย|ครับ|ค่ะ|คะ|นะ|วันนี้|พรุ่งนี้|ตอนนี้|มะรืนนี้|เมื่อวาน)$/;
const TIME_ONLY = /^(?:วันนี้|พรุ่งนี้|ตอนนี้|เมื่อวาน|มะรืนนี้)$/;

/** ชื่อสถานที่ในประโยค "อากาศที่เชียงใหม่เป็นไง" → "เชียงใหม่" (ไม่มี = ใช้ตำแหน่งปัจจุบัน) */
export function placeNameIn(text: string): string | null {
  let name = text.match(/(?:อากาศ|พยากรณ์|ฝน)(?:ตก|จะตก)?(?:ที่|ใน|แถว|ของ)\s*(\S+)/)?.[1] ?? '';
  for (let prev = ''; prev !== name;) {
    prev = name;
    name = name.replace(TRAILING, '');
  }
  return name && !TIME_ONLY.test(name) ? name : null;
}

export interface PlaceDeps {
  api?: PlaceApi;
}

export function createPlaceAgent(deps: PlaceDeps = {}): AgentDefinition {
  const api = deps.api ?? defaultApi();
  const NO_PERMISSION =
    'ยังไม่ได้อนุญาตให้เข้าถึงตำแหน่ง — เปิดสิทธิ์ตำแหน่งในตั้งค่าเครื่องก่อนครับ';

  return {
    id: PLACE_AGENT_ID,
    name: 'ตำแหน่งและอากาศ',
    description: 'บอกอากาศ ตำแหน่งปัจจุบัน และหาร้าน/สถานที่ใกล้ตัว',
    capabilities: [
      {
        id: 'place.where',
        label: 'ตำแหน่งปัจจุบัน',
        patterns: [
          /^(?:ตอนนี้)?(?:ฉัน|ผม)?อยู่(?:ที่)?ไหน$/,
          /^ตำแหน่ง(?:ของ)?(?:ฉัน|ผม)?(?:ตอนนี้)?(?:อยู่)?(?:ที่)?ไหน$/,
          /^where am i$/i,
        ],
        examples: ['ฉันอยู่ที่ไหน'],
      },
      {
        id: 'place.nearby',
        label: 'หาสถานที่ใกล้ฉัน',
        patterns: [
          /^(?<command>(?:หา|ค้นหา|แนะนำ|พาไป)?\s*(?:ร้านกาแฟ|คาเฟ่|ร้านอาหาร|ร้านข้าว|ร้านยา|โรงพยาบาล|ปั๊ม(?:น้ำมัน)?|ตู้เอทีเอ็ม|เอทีเอ็ม|atm|เซเว่น|ร้านสะดวกซื้อ|มินิมาร์ท|ห้องน้ำ|ธนาคาร).{0,20}(?:ใกล้|แถวนี้|แถวๆนี้|รอบๆ).*)$/i,
        ],
        examples: ['หาร้านกาแฟใกล้ฉัน', 'ปั๊มน้ำมันแถวนี้'],
      },
      {
        id: 'place.weather',
        label: 'อากาศ',
        patterns: [
          /^(?!.*(?:เขียน|แต่ง|อธิบาย|สรุป|แปล|ประวัติ|ทำไม)).{0,40}(?:อากาศ|พยากรณ์|ฝนตก|ฝนจะตก|อุณหภูมิ|ร้อนไหม|หนาวไหม|พกร่ม).{0,30}$/,
        ],
        examples: ['วันนี้อากาศเป็นไง', 'พรุ่งนี้ฝนจะตกไหม', 'อากาศที่เชียงใหม่'],
      },
    ],
    async run({ text, capabilityId }) {
      if (capabilityId === 'place.weather') {
        const named = placeNameIn(text);
        let coords: Coords | null;
        let where: string | null = null;
        if (named) {
          const geo = await api.getJson(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(named)}&count=1&language=th`,
          );
          const first = isRecord(geo) ? arr(geo.results)[0] : null;
          const lat = isRecord(first) ? n(first.latitude) : null;
          const lon = isRecord(first) ? n(first.longitude) : null;
          if (lat === null || lon === null) return { reply: `หาสถานที่ “${named}” ไม่เจอครับ` };
          coords = { lat, lon };
          where = named;
        } else {
          coords = await api.position();
          if (!coords) return { reply: NO_PERMISSION };
        }
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat.toFixed(3)}&longitude=${coords.lon.toFixed(3)}` +
          '&current=temperature_2m,apparent_temperature,weather_code' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
          '&timezone=auto&forecast_days=2';
        return { reply: summarizeWeather(await api.getJson(url), /พรุ่งนี้/.test(text), where) };
      }

      const coords = await api.position();
      if (!coords) return { reply: NO_PERMISSION };

      if (capabilityId === 'place.where') {
        const address = await api.reverse(coords);
        return {
          reply: address
            ? `ตอนนี้คุณอยู่แถว ${address} ครับ`
            : 'หาที่อยู่ไม่เจอครับ แต่ได้พิกัดแล้ว',
        };
      }

      const kind = PLACE_KINDS.find((k) => k.pattern.test(text));
      if (!kind) return { reply: 'อยากหาสถานที่แบบไหนครับ? เช่น ร้านกาแฟ ร้านยา ปั๊มน้ำมัน' };
      const query = `[out:json][timeout:15];node(around:2000,${coords.lat.toFixed(5)},${coords.lon.toFixed(5)})[${kind.tag}];out 25;`;
      const result = await api.getJson('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      const places = nearestPlaces(result, coords);
      if (places.length === 0) return { reply: `ไม่พบ${kind.label}ในรัศมี 2 กิโลเมตรครับ` };
      return {
        reply: `${kind.label}ใกล้สุด: ${places.map((p) => `${p.name} ห่าง ${spokenDistance(p.meters)}`).join(' · ')}`,
      };
    },
  };
}
