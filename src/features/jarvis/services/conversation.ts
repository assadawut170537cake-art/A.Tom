import { redactSecrets, toProviderError, userAdvice } from '../../../core/http/errors';
import { isOffline } from '../../../core/network/connectivity';
import { useAgentPanelStore } from '../../agents/stores/useAgentPanelStore';
import { aiOrchestrator } from '../../ai/core/Orchestrator';
import type { ChatMessage } from '../../ai/core/types';
import { getAppRouter } from '../../router/appRouter';
import type { RouterOutput } from '../../router/core/types';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { useAtomStore } from '../stores/useAtomStore';
import type { Message, Persona } from '../types';
import { stripMarkdown } from '../utils/markdown';

/** Latest sendMessage() turn; only that turn may move the orb mood past 'thinking'. */
let activeTurn = 0;

/** อัปเดตข้อความที่กำลังไหลไม่ถี่กว่านี้ (ms) — ทุก token = re-render รายการแชททุกครั้ง */
const STREAM_UPDATE_MS = 60;

/**
 * แสดงคำตอบครึ่งทางเป็นข้อความของผู้ช่วยที่ค่อย ๆ ยาวขึ้น (ยังไม่บันทึกจนตอบจบ)
 * `''` = provider ถัดไปเริ่มใหม่ → ลบข้อความครึ่งทางของตัวที่ล้ม
 */
function createStreamView(persona: Persona, isLatest: () => boolean) {
  let id: string | null = null;
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const store = () => useAtomStore.getState();

  const flush = () => {
    timer = null;
    if (id) store().updateMessage(persona, id, pending, { save: false });
  };

  return {
    onPartial(text: string) {
      if (!isLatest()) return;
      if (!text) {
        if (timer) clearTimeout(timer);
        timer = null;
        if (id) store().removeMessage(persona, id);
        id = null;
        store().setStreamingId(null);
        return;
      }
      pending = text;
      if (!id) {
        id = store().pushMessage({ role: 'assistant', content: text, persona }).id;
        store().setStreamingId(id);
      } else if (!timer) {
        timer = setTimeout(flush, STREAM_UPDATE_MS);
      }
    },
    /** จบรอบ: คืน id ข้อความครึ่งทาง (null = ไม่ได้ไหล) แล้วหยุดอัปเดต */
    finish(): string | null {
      if (timer) clearTimeout(timer);
      timer = null;
      if (store().streamingId === id) store().setStreamingId(null);
      const done = id;
      id = null;
      return done;
    },
  };
}

interface SendResult {
  route: RouterOutput | null;
  reply: string;
  error?: string;
  /** agent ที่ขอเปิด UI ในรอบนี้ (Agent Panel เปิดให้แล้ว) */
  agentScreen?: { agentId: string };
}

/**
 * One user turn: route the text → run the handler → append the reply to the (possibly new)
 * persona's own history → speak it with that persona's voice. Drives the orb mood throughout.
 */
interface SendOptions {
  /** false = ไม่พูดคำตอบ (ค่าเริ่มต้นพูด) */
  speak?: boolean;
  /**
   * เรียกก่อนเริ่มพูด — คืน false = ไม่ต้องพูดแล้ว (โหมดคุยด้วยเสียงถูกปิดระหว่างรอ AI ตอบ)
   * ใช้ให้โหมดไลฟ์รู้ว่าเข้าช่วง "กำลังพูด" แล้วด้วย
   */
  onSpeaking?: () => boolean;
}

export async function sendMessage(text: string, opts: SendOptions = {}): Promise<SendResult> {
  const content = text.trim();
  if (!content) return { route: null, reply: '' };

  const store = useAtomStore.getState();
  const persona = store.activePersona;
  const history: ChatMessage[] = store.messagesByPersona[persona]
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const turn = ++activeTurn;
  const isLatest = () => turn === activeTurn;
  const stream = createStreamView(persona, isLatest);
  store.pushMessage({ role: 'user', content, persona });
  store.setUIMode('conversation');
  store.setMood('thinking');

  try {
    // router ของแอป: ChatHandler มี Shared Memory (facts ถูกแนบใน system prompt)
    const { route, result } = await getAppRouter().handle({
      text: content,
      context: {
        activePersona: persona,
        recentMessages: history.slice(-5).map((m) => m.content),
        history,
        onPartial: stream.onPartial,
      },
    });
    const partialId = stream.finish();
    if (partialId && result.persona === persona) {
      // ข้อความที่ไหลมาแล้วกลายเป็นคำตอบจริง (แทนด้วยฉบับเต็ม เช่นมีแหล่งข้อมูลต่อท้าย) แล้วบันทึก
      useAtomStore.getState().updateMessage(persona, partialId, result.reply);
    } else {
      if (partialId) useAtomStore.getState().removeMessage(persona, partialId);
      // A switch moves the reply (the new persona's greeting) into the new persona's history
      useAtomStore.getState().pushMessage({ role: 'assistant', content: result.reply, persona: result.persona });
    }
    // agent ขอเปิด UI → เปิด Agent Panel (เฉพาะรอบล่าสุด — รอบเก่าที่จบช้าต้องไม่เปิดทับ)
    if (result.agentScreen && isLatest()) useAgentPanelStore.getState().open(result.agentScreen.agentId);
    // Keys rejected along the way (e.g. Gemini 401 while OpenRouter answered) still need fixing
    for (const notice of aiOrchestrator.takeNotices()) {
      useAtomStore.getState().pushMessage({ role: 'system', content: `⚠️ ${redactSecrets(notice)}`, persona: result.persona });
    }

    if (opts.speak !== false && result.reply && (opts.onSpeaking?.() ?? true)) {
      if (isLatest()) useAtomStore.getState().setMood('speaking');
      await voiceOrchestrator.speak(stripMarkdown(result.reply), result.persona).catch(() => {
        // Speech is best-effort; the text reply is already on screen
      });
    }
    return result.agentScreen
      ? { route, reply: result.reply, agentScreen: result.agentScreen }
      : { route, reply: result.reply };
  } catch (e) {
    const partialId = stream.finish();
    if (partialId) useAtomStore.getState().removeMessage(persona, partialId);
    aiOrchestrator.takeNotices(); // already listed in the aggregated error below
    const err = toProviderError('conversation', e);
    const error = redactSecrets(err.message);
    // A dead connection shows up as network errors or timeouts; say "offline" rather than blame providers
    const offline = err.kind === 'network' || (await isOffline());
    const advice = userAdvice(offline ? 'network' : err.kind);
    useAtomStore.getState().pushMessage({ role: 'system', content: `⚠️ ${advice}\n${error}`, persona });
    return { route: null, reply: '', error };
  } finally {
    // An older turn finishing must not reset the mood of a newer one still in flight
    if (isLatest()) useAtomStore.getState().setMood('idle');
  }
}

/** ข้อความของบอสที่ทำให้เกิดคำตอบนี้ (ข้อความ user ล่าสุดก่อนหน้า) */
function promptOf(message: Message): Message | undefined {
  const list = useAtomStore.getState().messagesByPersona[message.persona];
  const index = list.findIndex((m) => m.id === message.id);
  for (let i = index; i >= 0; i--) {
    const m = list[i];
    if (m?.role === 'user') return m;
  }
  return undefined;
}

/** ตอบใหม่: ลบตั้งแต่คำถามของคำตอบนี้ แล้วส่งคำถามเดิมอีกรอบ (ประวัติที่ส่งให้ AI จึงไม่มีคำตอบเก่า) */
export async function regenerate(message: Message): Promise<SendResult | null> {
  const prompt = promptOf(message);
  if (!prompt) return null;
  useAtomStore.getState().truncateFrom(prompt.persona, prompt.id);
  return sendMessage(prompt.content);
}

/** แก้ข้อความของบอส: ลบข้อความนั้นและที่ตามมา แล้วใส่ข้อความเดิมกลับในช่องพิมพ์ */
export function editMessage(message: Message): void {
  const store = useAtomStore.getState();
  store.truncateFrom(message.persona, message.id);
  store.setComposerDraft(message.content);
}

/** อ่านข้อความนี้ออกเสียงอีกครั้งด้วยเสียงของ persona เจ้าของข้อความ */
export function speakMessage(message: Message): void {
  void voiceOrchestrator.speak(stripMarkdown(message.content), message.persona).catch(() => undefined);
}
