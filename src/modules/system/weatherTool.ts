/**
 * @file Weather Tool: พยากรณ์อากาศสดจาก Open-Meteo API อิงพิกัด GPS จริง
 */

import * as Location from 'expo-location';

export interface WeatherData {
  city?: string;
  temperature: number;
  condition: string;
  conditionCode: number;
  humidity?: number;
  windSpeed?: number;
  forecast?: { day: string; tempMax: number; tempMin: number; condition: string }[];
}

export function getWeatherCondition(code: number): string {
  if (code === 0) return 'ท้องฟ้าแจ่มใส';
  if (code === 1 || code === 2) return 'มีเมฆบางส่วน';
  if (code === 3) return 'เมฆครึ้ม';
  if (code >= 45 && code <= 48) return 'มีหมอก';
  if (code >= 51 && code <= 55) return 'ฝนปรอยๆ';
  if (code >= 61 && code <= 65) return 'ฝนตก';
  if (code >= 71 && code <= 77) return 'หิมะตก';
  if (code >= 80 && code <= 82) return 'ฝนตกหนักเป็นช่วงๆ';
  if (code >= 95 && code <= 99) return 'พายุฝนฟ้าคะนอง';
  return 'สภาพอากาศแปรปรวน';
}

export async function fetchWeather(lat?: number, lon?: number): Promise<WeatherData> {
  let latitude = lat;
  let longitude = lon;
  let cityName = 'ตำแหน่งปัจจุบัน';

  if (latitude === undefined || longitude === undefined) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      }
    } catch {
      // Fallback
    }
  }

  if (latitude === undefined || longitude === undefined) {
    latitude = 13.7563;
    longitude = 100.5018;
    cityName = 'กรุงเทพมหานคร';
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const json = await res.json();
  const current = json.current;
  const condition = getWeatherCondition(current.weather_code);

  const forecastDays: WeatherData['forecast'] = [];
  if (json.daily?.time) {
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์'];
    for (let i = 0; i < Math.min(json.daily.time.length, 5); i++) {
      const d = new Date(json.daily.time[i]);
      forecastDays.push({
        day: days[d.getDay()] || json.daily.time[i],
        tempMax: Math.round(json.daily.temperature_2m_max[i]),
        tempMin: Math.round(json.daily.temperature_2m_min[i]),
        condition: getWeatherCondition(json.daily.weather_code[i]),
      });
    }
  }

  return {
    city: cityName,
    temperature: Math.round(current.temperature_2m),
    condition,
    conditionCode: current.weather_code,
    humidity: current.relative_humidity_2m,
    windSpeed: Math.round(current.wind_speed_10m),
    forecast: forecastDays,
  };
}
