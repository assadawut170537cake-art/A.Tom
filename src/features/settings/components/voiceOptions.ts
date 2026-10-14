import type { Voice } from '../../voice/core/types';
import type { SelectOption } from './ModelSelector';

export const PREVIEW_TEXT = 'สวัสดีครับบอส นี่คือเสียงทดสอบ';

const voiceOption = (v: Voice): SelectOption => ({
  value: v.id,
  label: v.name,
  hint: [v.language, v.gender].filter(Boolean).join(' · ') || undefined,
});

/**
 * Picker options for a voice list. A saved voice that isn't in the (possibly not yet loaded)
 * list is shown by its id so the current choice is always visible.
 */
export function voiceOptions(voices: Voice[], selectedId: string | undefined): SelectOption[] {
  const options = voices.map(voiceOption);
  if (selectedId && !options.some((o) => o.value === selectedId)) {
    options.unshift({ value: selectedId, label: selectedId, hint: undefined });
  }
  return options;
}
