/**
 * fetch() mock for provider tests: routes requests by URL to canned responses and records
 * every call (URL, method, headers, parsed JSON body). Lives outside __tests__ so Jest does
 * not collect it as a test file.
 */

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, raw string, FormData/bytes as given, or undefined. */
  body: unknown;
}

type Handler = (call: RecordedCall, init: RequestInit) => Response | Promise<Response>;
export type Route = [match: RegExp, handler: Handler];

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const bytes = (data = new Uint8Array([1, 2, 3])) => new Response(data);

export const httpError = (status: number, message = `error ${status}`) =>
  json({ error: { message } }, status);

/** Hosts of the three AI providers. */
export const GEMINI = /generativelanguage\.googleapis\.com/;
export const OPENROUTER = /openrouter\.ai/;
export const JEV = /api\.typesafe\.ai/;

export const geminiText = (text: string) =>
  json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    modelVersion: 'gemini-3-flash',
  });

export const openRouterText = (text: string, model = 'openai/gpt-5.6') =>
  json({
    model,
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  });

/** TypeSafe System One response for a choice question named `intent`. */
export const jevChoice = (choice: string, confidence?: number, probabilities?: Record<string, number>) =>
  json({
    model: 'jev-latest',
    answers: { intent: { type: 'choice', choice, confidence, probabilities } },
    usage: { input_tokens: 20, output_tokens: 1 },
  });

/** True when a Gemini/OpenAI-style request carries the intent-classifier system prompt. */
export function isClassifierCall(call: RecordedCall): boolean {
  const body = call.body as {
    systemInstruction?: { parts: { text: string }[] };
    messages?: { role: string; content: string }[];
  };
  const system =
    body?.systemInstruction?.parts[0]?.text ??
    body?.messages?.find((m) => m.role === 'system')?.content ??
    '';
  return system.startsWith('Classify the user message');
}

function headersOf(init: RequestInit): Record<string, string> {
  const h = init.headers;
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

function parseBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Install the mock; unmatched URLs reject so a forgotten route fails loudly. */
export function mockFetch(routes: Route[]) {
  const calls: RecordedCall[] = [];
  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: headersOf(init),
      body: parseBody(init.body),
    };
    calls.push(call);
    const route = routes.find(([match]) => match.test(call.url.href));
    if (!route) throw new Error(`Unmocked fetch: ${call.method} ${call.url.href}`);
    return route[1](call, init);
  });
  const hosts = () => calls.map((c) => c.url.host);
  return { calls, spy, hosts };
}

/** A fetch that never answers until its AbortSignal fires (for timeout tests). */
export function hangingFetch() {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
  );
}
