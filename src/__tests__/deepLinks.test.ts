import { applyDeepLink } from '../features/jarvis/hooks/useDeepLinks';
import { parseDeepLink, useDeepLinkStore } from '../features/jarvis/services/deepLinks';
import { useAtomStore } from '../features/jarvis/stores/useAtomStore';
import { useTabsStore } from '../features/jarvis/stores/useTabsStore';
import { resetStore } from '../test-utils/setup';

beforeEach(() => {
  resetStore();
  useTabsStore.setState({ activeTab: 'memory' });
  useDeepLinkStore.setState({ livePending: false });
});

describe('parseDeepLink', () => {
  test.each([
    ['atom://live', { type: 'live' }],
    ['atom:///voice/', { type: 'live' }],
    ['ATOM://Today', { type: 'tab', tab: 'today' }],
    ['atom://memory', { type: 'tab', tab: 'memory' }],
    ['atom://new', { type: 'new-chat' }],
    ['atom://chat', { type: 'chat', text: '' }],
    [`atom://chat?text=${encodeURIComponent('สวัสดี & ลาก่อน')}`, { type: 'chat', text: 'สวัสดี & ลาก่อน' }],
  ])('%s', (url, expected) => {
    expect(parseDeepLink(url)).toEqual(expected);
  });

  test.each([null, '', 'https://example.com', 'atom://delete-everything', 'exp://192.168.1.2:8081'])('ไม่รู้จัก: %s', (url) => {
    expect(parseDeepLink(url)).toBeNull();
  });
});

describe('applyDeepLink', () => {
  test('live → แท็บ Atom + คำขอเปิดไมค์ค้างไว้จนแท็บรับไป (ครั้งเดียว)', () => {
    applyDeepLink({ type: 'live' });
    expect(useTabsStore.getState().activeTab).toBe('atom');
    expect(useAtomStore.getState().uiMode).toBe('conversation');
    expect(useDeepLinkStore.getState().takeLive()).toBe(true);
    expect(useDeepLinkStore.getState().takeLive()).toBe(false);
  });

  test('chat?text → ใส่ข้อความรอในช่องพิมพ์ (ไม่ส่งเอง)', () => {
    applyDeepLink({ type: 'chat', text: 'ช่วยสรุปข่าว' });
    expect(useAtomStore.getState().composerDraft).toBe('ช่วยสรุปข่าว');
    expect(useAtomStore.getState().messagesByPersona[1]).toEqual([]);
  });

  test('tab / new-chat', () => {
    applyDeepLink({ type: 'tab', tab: 'today' });
    expect(useTabsStore.getState().activeTab).toBe('today');
    useAtomStore.getState().pushMessage({ role: 'user', content: 'เก่า' });
    applyDeepLink({ type: 'new-chat' });
    expect(useTabsStore.getState().activeTab).toBe('atom');
    expect(useAtomStore.getState().messagesByPersona[1]).toEqual([]);
  });
});
