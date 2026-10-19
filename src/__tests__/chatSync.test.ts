import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CHAT_CURSOR_KEY,
  CHAT_QUEUE_KEY,
  ChatSync,
  MAX_QUEUE,
  type ChatSyncTimers,
} from '../core/chat/ChatSync';
import {
  CHAT_SYNC_VERSION,
  isSyncableRole,
  parseSyncMessage,
  toWireMessage,
  type SyncMessage,
} from '../core/chat/chatSyncTypes';
import { RemoteChatAdapter } from '../core/chat/RemoteChatAdapter';
import type { ChatPullResult, ChatPushResult, ChatRemote } from '../core/chat/RemoteChatAdapter';
import type { Message } from '../core/types/message';
import { setLocalMessageSink, useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { startChatSync, toSyncMessage } from '../features/chat/chatSyncBridge';
import { json, mockFetch } from '../test-utils/mockFetch';
import { nth } from '../test-utils/nth';

const msg = (id: string, over: Partial<SyncMessage> = {}): SyncMessage => ({
  id,
  persona: 1,
  role: 'user',
  content: `m-${id}`,
  createdAt: 1000,
  ...over,
});

afterEach(() => jest.restoreAllMocks());

describe('chatSyncTypes', () => {
  test('parseSyncMessage: ผ่าน · persona string · role ที่ไม่ซิงก์/ข้อมูลขาด = null', () => {
    expect(
      parseSyncMessage({ id: 'a', persona: '2', role: 'assistant', content: 'hi', createdAt: 5 }),
    ).toEqual({
      id: 'a',
      persona: 2,
      role: 'assistant',
      content: 'hi',
      createdAt: 5,
    });
    expect(
      parseSyncMessage({ id: 'a', persona: '1', role: 'system', content: 'x', createdAt: 5 }),
    ).toBeNull();
    expect(
      parseSyncMessage({ id: 'a', persona: '9', role: 'user', content: 'x', createdAt: 5 }),
    ).toBeNull();
    expect(
      parseSyncMessage({ id: '', persona: '1', role: 'user', content: 'x', createdAt: 5 }),
    ).toBeNull();
    expect(parseSyncMessage({ id: 'a', persona: '1', role: 'user', createdAt: 5 })).toBeNull();
  });

  test('isSyncableRole · toWireMessage (persona → string)', () => {
    expect(isSyncableRole('user')).toBe(true);
    expect(isSyncableRole('system')).toBe(false);
    expect(toWireMessage(msg('a', { persona: 3 }))).toEqual({
      id: 'a',
      persona: '3',
      role: 'user',
      content: 'm-a',
      createdAt: 1000,
    });
  });
});

describe('RemoteChatAdapter', () => {
  const config = { baseUrl: 'https://abc.supabase.co', token: 'tok' };
  const HOST = /abc\.supabase\.co/;

  test('pull: Bearer + since · parse messages · ข้าม malformed', async () => {
    const { calls } = mockFetch([
      [
        HOST,
        () =>
          json({
            messages: [
              { id: 'a', persona: '1', role: 'user', content: 'hi', createdAt: 5 },
              { id: 'bad' },
            ],
            serverTimestamp: 42,
          }),
      ],
    ]);
    const res = await new RemoteChatAdapter(config).pull(10);
    expect(res).toEqual({
      messages: [msg('a', { content: 'hi', createdAt: 5 })],
      serverTimestamp: 42,
    });
    const call = nth(calls, 0);
    expect(call.url.pathname).toBe('/api/v1/chat/sync');
    expect(call.url.searchParams.get('since')).toBe('10');
    expect(call.headers.Authorization).toBe('Bearer tok');
  });

  test('push: ส่ง version + messages · อ่าน applied/serverTimestamp · 204 = ว่าง', async () => {
    const { calls } = mockFetch([[HOST, () => json({ applied: 2, serverTimestamp: 99 })]]);
    const res = await new RemoteChatAdapter(config).push([msg('a'), msg('b')]);
    expect(res).toEqual({ applied: 2, serverTimestamp: 99 });
    expect(nth(calls, 0).body).toEqual({
      version: CHAT_SYNC_VERSION,
      messages: [toWireMessage(msg('a')), toWireMessage(msg('b'))],
    });
  });

  test('push: 204 ไม่มี body → applied 0 · serverTimestamp จาก serverTime alias', async () => {
    mockFetch([[HOST, () => json({ serverTime: 7 })]]);
    await expect(new RemoteChatAdapter(config).push([msg('a')])).resolves.toEqual({
      applied: 0,
      serverTimestamp: 7,
    });
  });

  test('body ขาด serverTimestamp → invalid_response', async () => {
    mockFetch([[HOST, () => json({ messages: [] })]]);
    await expect(new RemoteChatAdapter(config).pull(0)).rejects.toThrow(
      /Mark 55 ส่งข้อมูลแชทไม่ครบ/,
    );
  });
});

/** ChatRemote ปลอม = เซิร์ฟเวอร์ในหน่วยความจำ */
function fakeChatRemote() {
  const pushed: SyncMessage[] = [];
  let toPull: SyncMessage[] = [];
  let serverTime = 100;
  let failWith: unknown = null;
  const remote: ChatRemote & { pull: jest.Mock; push: jest.Mock } = {
    pull: jest.fn(async (): Promise<ChatPullResult> => {
      if (failWith) throw failWith;
      const messages = toPull;
      toPull = [];
      return { messages, serverTimestamp: ++serverTime };
    }),
    push: jest.fn(async (messages: SyncMessage[]): Promise<ChatPushResult> => {
      if (failWith) throw failWith;
      pushed.push(...messages);
      return { applied: messages.length, serverTimestamp: ++serverTime };
    }),
  };
  return {
    remote,
    pushed,
    serverHas: (messages: SyncMessage[]) => void (toPull = messages),
    fail: (e: unknown) => void (failWith = e),
    heal: () => void (failWith = null),
  };
}

function manualTimers(): ChatSyncTimers & { tick: () => void; time: (t: number) => void } {
  let now = 0;
  let fn: (() => void) | null = null;
  return {
    now: () => now,
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => void (fn = null),
    tick: () => fn?.(),
    time: (t) => void (now = t),
  };
}

describe('ChatSync', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  function setup() {
    const applied: SyncMessage[] = [];
    const server = fakeChatRemote();
    const timers = manualTimers();
    const sync = new ChatSync({ apply: (m) => void applied.push(...m), timers, pollMs: 1000 });
    return { sync, server, timers, applied };
  }

  test('enqueue → push · ไม่ enqueue id ซ้ำ · เคลียร์คิวหลังส่ง', async () => {
    const { sync, server } = setup();
    sync.setRemote(server.remote);
    await sync.enqueue([msg('a'), msg('b'), msg('a')]); // 'a' ซ้ำในชุดเดียว
    await sync.syncNow();
    expect(server.pushed.map((m) => m.id)).toEqual(['a', 'b']);
    expect(sync.getSnapshot().pending).toBe(0);
  });

  test('pull → apply + cursor เดินหน้า · pull รอบหลังใช้ cursor ใหม่', async () => {
    const { sync, server, applied } = setup();
    server.serverHas([msg('x', { persona: 2 })]);
    sync.setRemote(server.remote);
    await sync.syncNow();
    expect(applied.map((m) => m.id)).toEqual(['x']);
    expect(sync.getSnapshot().cursor).toBe(101); // คิวว่าง = ไม่ push, pull เดิน 100→101
    await sync.syncNow();
    expect(nth(server.remote.pull.mock.calls, 1)[0]).toBe(101);
  });

  test('ค้างไว้ได้: restore คิว + cursor จาก storage', async () => {
    await AsyncStorage.setItem(CHAT_QUEUE_KEY, JSON.stringify([msg('q1')]));
    await AsyncStorage.setItem(CHAT_CURSOR_KEY, '555');
    const { sync, server } = setup();
    sync.setRemote(server.remote);
    await sync.syncNow();
    expect(server.pushed.map((m) => m.id)).toEqual(['q1']);
    expect(nth(server.remote.pull.mock.calls, 0)[0]).toBe(555);
  });

  test('ล้มเหลว → ไม่ทิ้งคิว + backoff (รอบถัดไปข้ามจนถึงเวลา)', async () => {
    const { sync, server, timers } = setup();
    sync.setRemote(server.remote);
    server.fail(new Error('offline'));
    await sync.enqueue([msg('a')]);
    await sync.syncNow();
    expect(sync.getSnapshot().pending).toBe(1); // ยังอยู่
    const callsAfterFail = server.remote.push.mock.calls.length;
    await sync.syncNow(); // ยังไม่ถึงเวลา backoff → ข้าม
    expect(server.remote.push.mock.calls.length).toBe(callsAfterFail);
    server.heal();
    timers.time(10_000); // พ้น backoff
    await sync.syncNow();
    expect(server.pushed.map((m) => m.id)).toEqual(['a']);
  });

  test('setRemote(null) หยุด timer · reset ล้างคิว+cursor', async () => {
    const { sync, server } = setup();
    sync.setRemote(server.remote);
    await sync.enqueue([msg('a')]);
    server.fail(new Error('x'));
    await sync.syncNow();
    await sync.reset();
    expect(sync.getSnapshot()).toEqual({ paired: false, pending: 0, cursor: 0 });
    expect(await AsyncStorage.getItem(CHAT_QUEUE_KEY)).toBeNull();
  });

  test('คิวไม่โตเกิน MAX_QUEUE', async () => {
    const { sync } = setup(); // ไม่มี remote → ค้างในคิว
    const many = Array.from({ length: MAX_QUEUE + 50 }, (_, i) => msg(`m${i}`));
    await sync.enqueue(many);
    expect(sync.getSnapshot().pending).toBe(MAX_QUEUE);
  });
});

describe('store.mergeRemoteMessages', () => {
  beforeEach(() => {
    useAtomStore.setState({
      messagesByPersona: { 1: [], 2: [], 3: [], 4: [] },
      historyLoaded: true,
    });
  });

  const m = (id: string, persona: 1 | 2, createdAt: number): Message => ({
    id,
    persona,
    role: 'user',
    content: id,
    createdAt,
  });

  test('merge แยก persona · dedupe id · เรียงตามเวลา', () => {
    useAtomStore.setState({
      messagesByPersona: { 1: [m('b', 1, 20)], 2: [], 3: [], 4: [] },
      historyLoaded: true,
    });
    useAtomStore.getState().mergeRemoteMessages([m('a', 1, 10), m('b', 1, 20), m('c', 2, 5)]);
    const s = useAtomStore.getState().messagesByPersona;
    expect(s[1].map((x) => x.id)).toEqual(['a', 'b']);
    expect(s[2].map((x) => x.id)).toEqual(['c']);
  });
});

describe('startChatSync bridge', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useAtomStore.setState({
      messagesByPersona: { 1: [], 2: [], 3: [], 4: [] },
      historyLoaded: true,
    });
    setLocalMessageSink(null);
  });

  function fakeBridge() {
    const server = fakeChatRemote();
    const sync = new ChatSync({
      apply: (msgs) => useAtomStore.getState().mergeRemoteMessages(msgs),
      timers: manualTimers(),
    });
    let listener: () => void = () => {};
    let conn: { baseUrl: string; token: string } | null = null;
    const stop = startChatSync({
      chatSync: sync,
      createRemote: () => server.remote,
      connection: async () => conn,
      subscribe: (l) => {
        listener = l;
        return () => {};
      },
    });
    return { server, sync, stop, pair: (c: typeof conn) => (conn = c), fire: () => listener() };
  }

  test('ข้อความใหม่ในเครื่อง (user/assistant) → enqueue · system ไม่ส่ง', async () => {
    const { server, stop, pair, fire } = fakeBridge();
    pair({ baseUrl: 'https://abc.supabase.co', token: 't' });
    fire();
    await new Promise((r) => setTimeout(r, 0));
    const { pushMessage } = useAtomStore.getState();
    pushMessage({ role: 'system', content: 'แจ้งเตือน' });
    const userMsg = pushMessage({ role: 'user', content: 'สวัสดี' });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.pushed.map((m) => m.id)).toEqual([userMsg.id]);
    stop();
  });

  test('จับคู่ → ส่งแชทที่มีอยู่ขึ้นรอบแรก · ยกเลิก → reset', async () => {
    useAtomStore
      .getState()
      .mergeRemoteMessages([{ id: 'old1', persona: 1, role: 'user', content: 'hi', createdAt: 1 }]);
    const { server, sync, stop, pair, fire } = fakeBridge();
    pair({ baseUrl: 'https://abc.supabase.co', token: 't' });
    fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(server.pushed.map((m) => m.id)).toContain('old1');
    expect(sync.getSnapshot().paired).toBe(true);

    pair(null);
    fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(sync.getSnapshot().paired).toBe(false);
    stop();
  });

  test('toSyncMessage: system → null', () => {
    expect(
      toSyncMessage({ id: 'a', persona: 1, role: 'system', content: 'x', createdAt: 1 }),
    ).toBeNull();
    expect(
      toSyncMessage({ id: 'a', persona: 1, role: 'user', content: 'x', createdAt: 1 })?.id,
    ).toBe('a');
  });
});
