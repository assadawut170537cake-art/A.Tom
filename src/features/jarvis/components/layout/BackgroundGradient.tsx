import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { PERSONAS } from '../../constants';
import { useAtomStore } from '../../stores/useAtomStore';

export function BackgroundGradient() {
  const color = PERSONAS[useAtomStore((s) => s.activePersona)].color;

  return (
    <LinearGradient
      pointerEvents="none"
      colors={['#05060a', `${color}26`, '#05060a', '#000000']}
      locations={[0, 0.42, 0.75, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
}
