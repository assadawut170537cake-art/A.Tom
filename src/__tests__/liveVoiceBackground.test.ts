import { setAudioModeAsync, type AudioRecorder } from 'expo-audio';

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
