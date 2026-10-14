import { Keyboard, Monitor, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { LAYOUT } from '../../constants';
import { ActionButton } from '../shared/ActionButton';

interface ActionBarProps {
  onAdd?: () => void;
  onComputer?: () => void;
  onKeyboard?: () => void;
}

export function ActionBar({ onAdd, onComputer, onKeyboard }: ActionBarProps) {
  return (
    <View
      className="absolute left-0 right-0 flex-row items-center justify-center gap-6"
      style={{ bottom: LAYOUT.actionBar.bottom, zIndex: 12 }}
    >
      <ActionButton icon={Plus} accessibilityLabel="เพิ่ม" onPress={onAdd} />
      <ActionButton icon={Monitor} accessibilityLabel="คอมพิวเตอร์" onPress={onComputer} size={60} />
      <ActionButton icon={Keyboard} accessibilityLabel="พิมพ์ข้อความ" onPress={onKeyboard} />
    </View>
  );
}
