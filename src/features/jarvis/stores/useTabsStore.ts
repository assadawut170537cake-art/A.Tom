import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TabKey } from '../types';

interface TabsState {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set) => ({
      activeTab: 'atom',
      setActiveTab: (activeTab) => set({ activeTab }),
    }),
    {
      name: 'atom-tabs',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
