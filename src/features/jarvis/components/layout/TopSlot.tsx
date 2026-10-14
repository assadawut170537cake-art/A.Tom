import { View } from 'react-native';

import { LAYOUT } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';
import { PersonaDropdown } from '../orb/PersonaDropdown';

/**
 * Shared slot at top:72. Idle → PersonaDropdown. Conversation → empty: the Orb
 * (OrbLayer) animates into this same position.
 */
export function TopSlot() {
  const isIdle = useAtomStore((s) => s.uiMode === 'idle');

  if (!isIdle) return null;

  return (
    <View
      className="absolute left-0 right-0 items-center"
      style={{ top: LAYOUT.dropdown.top, zIndex: 20 }}
    >
      <PersonaDropdown />
    </View>
  );
}
