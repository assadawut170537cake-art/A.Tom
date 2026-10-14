import { toProviderError } from '../../../core/http/errors';
import type { ChatMessage } from '../../ai/core/types';
import { IntentRouter } from '../../router/core/IntentRouter';
import type { RouterOutput } from '../../router/core/types';
import { voiceOrchestrator } from '../../voice/core/VoiceOrchestrator';
import { useAtomStore } from '../stores/useAtomStore';

let router: IntentRouter | null = null;
const getRouter = () => (router ??= new IntentRouter());

interface SendResult {
  route: RouterOutput | null;
  reply: string;
  error?: string;
}

/**
 * One user turn: route the text → run the handler → append the reply to the (possibly new)
 * persona's own history → speak it with that persona's voice. Drives the orb mood throughout.
 */
export async function sendMessage(text: string, opts: { speak?: boolean } = {}): Promise<SendResult> {
  const content = text.trim();
  if (!content) return { route: null, reply: '' };

  const store = useAtomStore.getState();
  const persona = store.activePersona;
  const history: ChatMessage[] = store.messagesByPersona[persona]
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  store.pushMessage({ role: 'user', content, persona });
  store.setUIMode('conversation');
  store.setMood('thinking');

  try {
    const { route, result } = await getRouter().handle({
      text: content,
      context: {
        activePersona: persona,
        recentMessages: history.slice(-5).map((m) => m.content),
        history,
      },
    });
    // A switch moves the reply (the new persona's greeting) into the new persona's history
    useAtomStore.getState().pushMessage({ role: 'assistant', content: result.reply, persona: result.persona });

    if (opts.speak !== false && result.reply) {
      useAtomStore.getState().setMood('speaking');
      await voiceOrchestrator.speak(result.reply, result.persona).catch(() => {
        // Speech is best-effort; the text reply is already on screen
      });
    }
    return { route, reply: result.reply };
  } catch (e) {
    const error = toProviderError('conversation', e).message;
    useAtomStore.getState().pushMessage({ role: 'system', content: `⚠️ ${error}`, persona });
    return { route: null, reply: '', error };
  } finally {
    useAtomStore.getState().setMood('idle');
  }
}
