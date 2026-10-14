import { Atom, Brain, CalendarDays, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { PERSONAS, TABS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';
import { useTabsStore } from '../../stores/useTabsStore';
import type { TabKey } from '../../types';
import { TabButton } from '../shared/TabButton';

const TAB_ICONS: Record<TabKey, LucideIcon> = {
  atom: Atom,
  today: CalendarDays,
  memory: Brain,
};

export function BottomTabs() {
  const activeTab = useTabsStore((s) => s.activeTab);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const accent = PERSONAS[useAtomStore((s) => s.activePersona)].color;

  return (
    <View
      accessibilityRole="tablist"
      className="absolute bottom-0 left-0 right-0 flex-row border-t border-white/10 bg-black/40 px-6 pb-1 pt-1"
      style={{ zIndex: 12 }}
    >
      {TABS.map((tab) => (
        <TabButton
          key={tab.key}
          label={tab.label}
          icon={TAB_ICONS[tab.key]}
          active={tab.key === activeTab}
          accentColor={accent}
          onPress={() => setActiveTab(tab.key)}
        />
      ))}
    </View>
  );
}
