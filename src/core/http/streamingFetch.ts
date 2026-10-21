/**
 * @file fetch ที่อ่าน response body เป็นสตรีมได้จริงบนมือถือ — ใช้กับคำตอบ LLM แบบ SSE (Voice: พูดระหว่าง AI ยังคิด)
 *
 * fetch ของ React Native อ่าน body ได้แค่ทั้งก้อน · `expo/fetch` (มากับ expo อยู่แล้ว ไม่ใช่ dependency ใหม่)
 * คืน `body.getReader()` ที่ส่งข้อมูลทีละท่อนจาก native · jest: mock ให้ชี้ไปที่ global fetch (jest.setup.js)
 */

import { fetch as expoFetch } from 'expo/fetch';

import type { StreamingFetch } from './request';

export const streamingFetch: StreamingFetch = (url, init) =>
  expoFetch(url, {
    ...(init.method !== undefined && { method: init.method }),
    ...(init.headers !== undefined && { headers: init.headers }),
    ...(init.body !== undefined && { body: init.body }),
    ...(init.signal !== undefined && { signal: init.signal }),
  });
