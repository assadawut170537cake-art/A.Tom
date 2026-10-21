import { redactSecrets, toProviderError, userAdvice } from '../../../core/http/errors';
import { isOffline } from '../../../core/network/connectivity';
import type { AttachmentData, AttachmentRef } from '../../../core/types/attachment';
import { readAttachment } from '../../attachments/attachments';
import { useAgentPanelStore } from '../../agents/stores/useAgentPanelStore';
import { aiOrchestrator } from '../../ai/core/Orchestrator';
import type { ChatMessage } from '../../ai/core/types';
import { getAppRouter } from '../../router/appRouter';
import type { RouterOutput } from '../../router/core/types';
import { voiceOrchestrator, type SpeechStream } from '../../voice/core/VoiceOrchestrator';
import { useAtomStore } from '../stores/useAtomStore';

/** Latest sendMessage() turn; only that turn may move the orb mood past 'thinking'. */
let activeTurn = 0;

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
  /** ไฟล์ที่บอสแนบ (ปุ่ม +) — อ่านเนื้อไฟล์ตอนส่ง แล้วให้ AI อ่าน */
  attachments?: AttachmentRef[] | undefined;
}

/** ตอบนานเกินนี้ → ขึ้นข้อความบอกว่าช้าช่วงไหน (หาสาเหตุตอบช้าบนเครื่องจริง) */
export const SLOW_REPLY_MS = 12_000;

/** แนบไฟล์มาแต่ไม่พิมพ์อะไร */
export const ATTACHMENT_ONLY_PROMPT = 'ช่วยดูไฟล์ที่แนบมาให้หน่อย';

export async function sendMessage(text: string, opts: SendOptions = {}): Promise<SendResult> {
  const refs = opts.attachments ?? [];
  const content = text.trim() || (refs.length ? ATTACHMENT_ONLY_PROMPT : '');
  if (!content) return { route: null, reply: '' };

  const store = useAtomStore.getState();
  const persona = store.activePersona;
  const history: ChatMessage[] = store.messagesByPersona[persona]
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const turn = ++activeTurn;
  const isLatest = () => turn === activeTurn;
  store.clearStreaming(); // รอบใหม่ — ล้างบับเบิลสดของรอบก่อน (ถ้ามีค้าง) ไม่ให้ข้อความต่อกัน
  store.pushMessage({ role: 'user', content, persona, attachments: refs });
  store.setUIMode('conversation');
  store.setMood('thinking');

  // อ่านเนื้อไฟล์ตอนส่ง (ประวัติเก็บแค่ที่อยู่) · อ่านไม่ได้ = บอกเหตุผล แล้วส่งที่เหลือต่อ
  const attachments: AttachmentData[] = [];
  for (const ref of refs) {
    const { data, reason } = await readAttachment(ref);
    if (data) attachments.push(data);
    else if (reason) store.pushMessage({ role: 'system', content: `⚠️ ${reason}`, persona });
  }

  // สตรีม: ข้อความที่ AI กำลังพิมพ์ → บับเบิลสด + เริ่มพูดตั้งแต่ประโยคแรก (ไม่รอตอบจบทั้งก้อน)
  const speakAllowed = opts.speak !== false;
  // ref object: ถูกตั้งค่าใน callback ของสตรีม (TS ตามการกำหนดค่าใน closure ไม่ได้ถ้าใช้ let เปล่า)
  const speech: { current: SpeechStream | null } = { current: null };
  let speechRefused = false;
  const startedAt = Date.now();
  let firstDeltaAt = 0;
  const onDelta = (delta: string) => {
    if (!firstDeltaAt) firstDeltaAt = Date.now();
    if (!isLatest()) return; // รอบเก่าที่ยังพิมพ์ค้างต้องไม่มาแทรกรอบใหม่
    useAtomStore.getState().appendStreaming(persona, delta);
    if (!speakAllowed || speechRefused) return;
    speech.current ??= voiceOrchestrator.speakStream(persona, {
      onFirst: () => {
        // โหมดเสียงถูกปิดระหว่างรอ AI (onSpeaking คืน false) → ไม่พูดเลย
        if (!isLatest() || !(opts.onSpeaking?.() ?? true)) {
          speechRefused = true;
          return false;
        }
        useAtomStore.getState().setMood('speaking');
        return true;
      },
    });
    speech.current.push(delta);
  };

  try {
    // router ของแอป: ChatHandler มี Shared Memory (facts ถูกแนบใน system prompt)
    const { route, result } = await getAppRouter().handle({
      text: content,
      onDelta,
      ...(attachments.length && { attachments }),
      context: {
        activePersona: persona,
        recentMessages: history.slice(-5).map((m) => m.content),
        history,
      },
    });
    if (isLatest()) useAtomStore.getState().clearStreaming();
    // A switch moves the reply (the new persona's greeting) into the new persona's history
    useAtomStore.getState().pushMessage({
      role: 'assistant',
      content: result.reply,
      persona: result.persona,
      imageUri: result.imageUri,
    });
    // ตอบช้า → บอกว่าช้าช่วงไหน (ก่อนเริ่มพิมพ์ = ตัดสินใจคำสั่ง/รอโมเดล · หลังเริ่มพิมพ์ = โมเดลพิมพ์ยาว) ให้บอสส่งทีมแก้ตรงจุด
    const took = Date.now() - startedAt;
    if (took > SLOW_REPLY_MS) {
      const first = firstDeltaAt
        ? ` · เริ่มพิมพ์หลัง ${((firstDeltaAt - startedAt) / 1000).toFixed(1)} วิ`
        : '';
      useAtomStore.getState().pushMessage({
        role: 'system',
        content: `⏱ ตอบช้า ${(took / 1000).toFixed(1)} วิ${first} · ทาง ${route.intent}/${route.provider}`,
        persona: result.persona,
      });
    }
    // agent ขอเปิด UI → เปิด Agent Panel (เฉพาะรอบล่าสุด — รอบเก่าที่จบช้าต้องไม่เปิดทับ)
    if (result.agentScreen && isLatest())
      useAgentPanelStore.getState().open(result.agentScreen.agentId);
    // Keys rejected along the way (e.g. Gemini 401 while OpenRouter answered) still need fixing
    for (const notice of aiOrchestrator.takeNotices()) {
      useAtomStore.getState().pushMessage({
        role: 'system',
        content: `⚠️ ${redactSecrets(notice)}`,
        persona: result.persona,
      });
    }

    if (result.streamed) {
      // พูดไประหว่างทางแล้ว — รอพูดส่วนที่เหลือให้จบ (ไม่พูดซ้ำทั้งก้อน)
      if (speech.current) await speech.current.end().catch(() => undefined);
    } else if (speakAllowed && result.reply && (opts.onSpeaking?.() ?? true)) {
      if (isLatest()) useAtomStore.getState().setMood('speaking');
      await voiceOrchestrator.speak(result.reply, result.persona).catch(() => {
        // Speech is best-effort; the text reply is already on screen
      });
    }
    return result.agentScreen
      ? { route, reply: result.reply, agentScreen: result.agentScreen }
      : { route, reply: result.reply };
  } catch (e) {
    if (isLatest()) useAtomStore.getState().clearStreaming();
    if (speech.current) voiceOrchestrator.stop(); // ตอบไม่สำเร็จ → หยุดเสียงที่อาจเริ่มไปแล้ว
    aiOrchestrator.takeNotices(); // already listed in the aggregated error below
    const err = toProviderError('conversation', e);
    const error = redactSecrets(err.message);
    // A dead connection shows up as network errors or timeouts; say "offline" rather than blame providers
    const offline = err.kind === 'network' || (await isOffline());
    const advice = userAdvice(offline ? 'network' : err.kind);
    useAtomStore
      .getState()
      .pushMessage({ role: 'system', content: `⚠️ ${advice}\n${error}`, persona });
    return { route: null, reply: '', error };
  } finally {
    // An older turn finishing must not reset the mood of a newer one still in flight
    if (isLatest()) useAtomStore.getState().setMood('idle');
  }
}
