import { ChevronDown, Lock } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { LAYOUT, PERSONA_IDS, PERSONAS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';
import type { Persona } from '../../types';

export function PersonaDropdown() {
  const activePersona = useAtomStore((s) => s.activePersona);
  const dropdownOpen = useAtomStore((s) => s.dropdownOpen);
  const toggleDropdown = useAtomStore((s) => s.toggleDropdown);
  const closeDropdown = useAtomStore((s) => s.closeDropdown);
  const setActivePersona = useAtomStore((s) => s.setActivePersona);

  const active = PERSONAS[activePersona];

  const select = (id: Persona) => {
    setActivePersona(id);
    closeDropdown();
  };

  return (
    <View className="items-center" style={{ width: LAYOUT.dropdown.width }}>
      <Pressable
        onPress={toggleDropdown}
        accessibilityRole="button"
        accessibilityLabel={`เลือกผู้ช่วย (ตอนนี้: ${active.name})`}
        accessibilityState={{ expanded: dropdownOpen }}
        className="flex-row items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2.5 active:bg-white/15"
      >
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: active.color }} />
        <Text className="text-[15px] font-semibold text-white">{active.name}</Text>
        <Text className="text-xs font-medium tracking-widest text-white/40">{active.nameEn}</Text>
        <View style={{ transform: [{ rotate: dropdownOpen ? '180deg' : '0deg' }] }}>
          <ChevronDown size={16} color="rgba(255,255,255,0.7)" />
        </View>
      </Pressable>

      {dropdownOpen && (
        <View
          className="absolute top-full mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#11131a]/95 py-1.5"
          style={{ width: LAYOUT.dropdown.width }}
        >
          {PERSONA_IDS.map((id) => {
            const p = PERSONAS[id];
            const selected = id === activePersona;
            return (
              <Pressable
                key={id}
                onPress={() => select(id)}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                className={`flex-row items-center gap-3 px-4 py-3 active:bg-white/10 ${selected ? 'bg-white/5' : ''}`}
              >
                <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                <View className="flex-1">
                  <Text className="text-[15px] font-medium text-white">
                    {p.name} <Text className="text-xs tracking-widest text-white/40">{p.nameEn}</Text>
                  </Text>
                  <Text className="mt-0.5 text-xs text-white/50">{p.desc}</Text>
                </View>
                {selected && <View className="h-1.5 w-1.5 rounded-full bg-white/70" />}
              </Pressable>
            );
          })}

          <View className="mx-4 my-1 h-px bg-white/10" />

          <View
            accessibilityRole="menuitem"
            accessibilityState={{ disabled: true }}
            className="flex-row items-center gap-3 px-4 py-3 opacity-40"
          >
            <Lock size={14} color="#fff" />
            <Text className="flex-1 text-[15px] font-medium text-white">ประชุม</Text>
            <Text className="text-[11px] text-white/70">เร็วๆ นี้</Text>
          </View>
        </View>
      )}
    </View>
  );
}
