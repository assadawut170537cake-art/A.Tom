/**
 * @file หน้าเว็บสำหรับสร้าง API key ของแต่ละผู้ให้บริการ — แสดงเป็นลิงก์ "🔗 สร้าง API Key" ใต้ช่อง key
 *
 * `null` = ไม่มีหน้าเดียวที่ชี้ได้ (เช่น Custom ที่บอสตั้ง server เอง) → ไม่แสดงลิงก์
 * provider ที่ไม่อยู่ใน {@link KEY_URL_SOURCE} ก็ไม่แสดงลิงก์เช่นกัน
 */

export const PROVIDER_KEY_URLS = {
  gemini: 'https://aistudio.google.com/apikey',
  'google-cloud-tts': 'https://console.cloud.google.com/apis/credentials',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  azure: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
  polly: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  dahl: 'https://dahl.global',
  xai: 'https://console.x.ai',
  custom: null,
} as const satisfies Record<string, string | null>;

export type KeyScope = 'ai' | 'tts' | 'stt';

/**
 * provider id ในแต่ละ scope → รายการใน {@link PROVIDER_KEY_URLS}
 * ต้องมีตารางนี้เพราะ id ซ้ำกันข้าม scope (เช่น `google`) และบางเจ้าใช้ key ของอีกบริษัท
 * (Whisper ใช้ key ของ OpenAI, Gemini TTS ใช้ key เดียวกับ Gemini LLM)
 */
const KEY_URL_SOURCE: Partial<Record<`${KeyScope}.${string}`, keyof typeof PROVIDER_KEY_URLS>> = {
  'ai.gemini': 'gemini',
  'ai.openrouter': 'openrouter',
  'ai.dahl-minimax': 'dahl',
  'ai.dahl-deepseek': 'dahl',
  'ai.dahl-glm': 'dahl',
  'ai.xai': 'xai',
  'ai.custom': 'custom',
  'tts.gemini': 'gemini',
  'tts.openai': 'openai',
  'tts.elevenlabs': 'elevenlabs',
  'tts.google': 'google-cloud-tts',
  'tts.azure': 'azure',
  'tts.polly': 'polly',
  'tts.xai': 'xai',
  'tts.custom': 'custom',
  'stt.whisper': 'openai',
  'stt.google': 'google-cloud-tts',
  'stt.azure': 'azure',
  'stt.xai': 'xai',
  'stt.custom': 'custom',
};

/** URL สำหรับสร้าง key ของ provider นี้ หรือ undefined ถ้าไม่มีลิงก์ให้แสดง */
export function keyUrlFor(scope: KeyScope, providerId: string): string | undefined {
  const source = KEY_URL_SOURCE[`${scope}.${providerId}`];
  return (source && PROVIDER_KEY_URLS[source]) ?? undefined;
}
