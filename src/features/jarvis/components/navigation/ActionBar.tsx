import { Keyboard, Mic, MicOff, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { LAYOUT } from '../../constants';
import { ActionButton } from '../shared/ActionButton';

interface ActionBarProps {
  onAdd?: () => void;
  /** ปุ่มกลาง = กดคุย / กดเลิกคุย (โหมดเสียงไลฟ์) — เดิมเป็นปุ่มคอม แต่สั่งคอมผ่านอัลตรอนได้แล้ว (Boss 2026-10-20) */
  onTalk?: () => void;
  talking?: boolean;
  talkDisabled?: boolean;
  onKeyboard?: () => void;
}

export function ActionBar({ onAdd, onTalk, talking, talkDisabled, onKeyboard }: ActionBarProps) {
  return (
    <View
      className="absolute left-0 right-0 flex-row items-center justify-center gap-6"
      style={{ bottom: LAYOUT.actionBar.bottom, zIndex: 12 }}
    >
      <ActionButton icon={Plus} accessibilityLabel="เพิ่ม" onPress={onAdd} />
      <ActionButton
        icon={talking ? MicOff : Mic}
        accessibilityLabel={talking ? 'เลิกคุย' : 'กดคุย'}
        onPress={onTalk}
        disabled={!talking && talkDisabled === true}
        size={60}
      />
      <ActionButton icon={Keyboard} accessibilityLabel="พิมพ์ข้อความ" onPress={onKeyboard} />
    </View>
  );
}
