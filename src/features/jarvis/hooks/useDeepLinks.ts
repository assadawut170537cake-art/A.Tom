import { useEffect } from 'react';
import { Linking } from 'react-native';

import { parseDeepLink, useDeepLinkStore, type DeepLinkAction } from '../services/deepLinks';
import { useAtomStore } from '../stores/useAtomStore';
import { useTabsStore } from '../stores/useTabsStore';

export function applyDeepLink(action: DeepLinkAction): void {
  const tabs = useTabsStore.getState();
  const atom = useAtomStore.getState();
  switch (action.type) {
    case 'tab':
      tabs.setActiveTab(action.tab);
      return;
    case 'live':
      tabs.setActiveTab('atom');
      atom.setUIMode('conversation');
      useDeepLinkStore.getState().requestLive();
      return;
    case 'new-chat':
      tabs.setActiveTab('atom');
      atom.newChat();
      atom.setUIMode('conversation');
      return;
    case 'chat':
      tabs.setActiveTab('atom');
      atom.setUIMode('conversation');
      if (action.text) atom.setComposerDraft(action.text);
      return;
  }
}

/** ฟังลิงก์ `atom://…` ทั้งตอนเปิดแอปจากลิงก์ และตอนแอปเปิดอยู่แล้ว */
export function useDeepLinks(): void {
  useEffect(() => {
    let active = true;
    const handle = (url: string | null) => {
      const action = parseDeepLink(url);
      if (action && active) applyDeepLink(action);
    };
    Linking.getInitialURL()
      .then(handle)
      .catch((e: unknown) => console.error('[links] อ่านลิงก์ตอนเปิดแอปไม่ได้', e));
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
}
