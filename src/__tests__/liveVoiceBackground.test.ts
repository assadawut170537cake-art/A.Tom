import {
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import { Platform } from 'react-native';

import { createRecorderAdapter } from '../features/jarvis/hooks/useLiveVoice';

/** recorder ปลอมเท่าที่ adapter ใช้ — ส่วนอื่นของ AudioRecorder ไม่ถูกเรียก */
function fakeRecorder(): AudioRecorder {
  const recorder = {
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(),
    stop: jest.fn(async () => {}),
    getStatus: jest.fn(() => ({ metering: -160 })),
    uri: 'file:///cache/rec.m4a',
  };
  // trust boundary ของ test: adapter ใช้แค่ฟิลด์ด้านบน
  return recorder as unknown as AudioRecorder;
}

test('live voice keeps the mic in background (switch to another app and say "กดปุ่ม …")', async () => {
  const adapter = createRecorderAdapter(fakeRecorder());
  await adapter.start();
  expect(setAudioModeAsync).toHaveBeenCalledWith({
    allowsRecording: true,
    playsInSilentMode: true,
    allowsBackgroundRecording: true,
  });
  await adapter.stop();
  expect(setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false });
});

test('Android ไม่ได้สิทธิ์แจ้งเตือน → ยังอัดได้ (ปิด background แทน ไม่ให้ expo-audio โยน error จนไมค์เงียบ)', async () => {
  const os = Platform.OS;
  Platform.OS = 'android';
  jest
    .mocked(requestNotificationPermissionsAsync)
    .mockResolvedValueOnce({
      granted: false,
      status: 'denied',
      canAskAgain: false,
      expires: 'never',
    } as never);
  try {
    const recorder = fakeRecorder();
    await createRecorderAdapter(recorder).start();
    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecording: true, allowsBackgroundRecording: false }),
    );
    expect(recorder.record).toHaveBeenCalled();
  } finally {
    Platform.OS = os;
  }
});
