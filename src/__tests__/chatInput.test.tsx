import { fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { TextInput } from 'react-native';

import { CHAT_INPUT_MAX_HEIGHT, ChatInput } from '../features/jarvis/components/chat/ChatInput';

const input = () => screen.getByLabelText('ช่องพิมพ์ข้อความ');
const sendButton = () => screen.getByLabelText('ส่งข้อความ');
const isSendDisabled = () => Boolean(sendButton().props.accessibilityState?.disabled);

async function renderInput(props: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const onSend = jest.fn();
  await render(<ChatInput onSend={onSend} {...props} />);
  return onSend;
}

describe('ChatInput', () => {
  test('type + press send → onSend gets the trimmed text, then the box is cleared', async () => {
    const onSend = await renderInput();
    await fireEvent.changeText(input(), '  วันนี้อากาศเป็นไง  ');
    expect(isSendDisabled()).toBe(false);
    await fireEvent.press(sendButton());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('วันนี้อากาศเป็นไง');
    expect(input().props.value).toBe('');
    expect(isSendDisabled()).toBe(true);
  });

  test('empty or whitespace-only text cannot be sent', async () => {
    const onSend = await renderInput();
    expect(isSendDisabled()).toBe(true);
    await fireEvent.changeText(input(), '   \n  ');
    await fireEvent.press(sendButton());
    expect(onSend).not.toHaveBeenCalled();
    expect(isSendDisabled()).toBe(true);
  });

  test('disabled (assistant thinking/speaking) → sending is blocked but the draft is kept', async () => {
    const onSend = await renderInput({ disabled: true });
    await fireEvent.changeText(input(), 'ข้อถัดไป');
    expect(isSendDisabled()).toBe(true);
    await fireEvent.press(sendButton());
    expect(onSend).not.toHaveBeenCalled();
    expect(input().props.value).toBe('ข้อถัดไป'); // still editable, so the keyboard stays open
    expect(input().props.editable).not.toBe(false);
  });

  test('re-enabled after disabled → the kept draft can be sent', async () => {
    const onSend = jest.fn();
    const { rerender } = await render(<ChatInput onSend={onSend} disabled />);
    await fireEvent.changeText(input(), 'รอบสอง');
    await rerender(<ChatInput onSend={onSend} disabled={false} />);
    await fireEvent.press(sendButton());
    expect(onSend).toHaveBeenCalledWith('รอบสอง');
  });

  test('multi-line up to 4 lines (then scrolls inside the box)', async () => {
    await renderInput();
    expect(input().props.multiline).toBe(true);
    const style = Object.assign({}, ...[input().props.style].flat()) as { lineHeight: number; maxHeight: number };
    expect(style.maxHeight).toBe(CHAT_INPUT_MAX_HEIGHT);
    expect(Math.floor((style.maxHeight - 16) / style.lineHeight)).toBe(4);
  });

  test('placeholder, accent colour and focus callback come from props; ref reaches the TextInput', async () => {
    const onFocus = jest.fn();
    const ref = createRef<TextInput>();
    await render(
      <ChatInput ref={ref} onSend={jest.fn()} onFocus={onFocus} placeholder="พิมพ์ข้อความถึงจาร์วิส…" accentColor="#3b82f6" />
    );
    expect(screen.getByPlaceholderText('พิมพ์ข้อความถึงจาร์วิส…')).toBeTruthy();
    await fireEvent.changeText(input(), 'x');
    const bg = Object.assign({}, ...[sendButton().props.style].flat()) as { backgroundColor?: string };
    expect(bg.backgroundColor).toBe('#3b82f6');
    await fireEvent(input(), 'focus');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeInstanceOf(TextInput);
  });
});
