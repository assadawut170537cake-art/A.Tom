/* eslint-env jest */
// Native modules that jest-expo doesn't mock out of the box.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  const { forwardRef } = require('react');
  return {
    WebView: forwardRef((props, _ref) => <View testID="webview" {...props} />),
  };
});

// In-memory SecureStore so key save/delete round-trips work in tests
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
  };
});

jest.mock('expo-speech', () => ({
  maxSpeechInputLength: 4000,
  speak: jest.fn((_text, opts) => opts?.onDone?.()),
  stop: jest.fn(),
  getAvailableVoicesAsync: jest.fn(async () => [
    { identifier: 'th-TH-voice', name: 'Kanya', language: 'th-TH', quality: 'Default' },
  ]),
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
  })),
  // โหมดคุยด้วยเสียง (useLiveVoice): recorder ปลอม — เงียบเสมอ (metering -160) จนกว่า test จะ mock เอง
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 } },
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: jest.fn(() => {
    const { useState } = require('react');
    const [recorder] = useState(() => ({
      id: 'rec',
      uri: null,
      isRecording: false,
      prepareToRecordAsync: jest.fn(async () => {}),
      record: jest.fn(function () {
        this.isRecording = true;
        this.uri = 'file:///cache/live.m4a';
      }),
      stop: jest.fn(async function () {
        this.isRecording = false;
      }),
      getStatus: jest.fn(() => ({ canRecord: true, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, metering: -160, url: null })),
    }));
    return recorder;
  }),
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
}));

const ONLINE = { type: 'WIFI', isConnected: true, isInternetReachable: true };
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ONLINE),
  useNetworkState: jest.fn(() => ONLINE),
}));

// Mirrors the real expo-file-system File (which implements Blob) closely enough for uploads
jest.mock('expo-file-system', () => {
  const AUDIO = new Uint8Array([82, 73, 70, 70]);
  class File extends Blob {
    constructor(...parts) {
      super([AUDIO]);
      this.uri = parts.map((p) => p.uri ?? p).join('/');
      this.name = this.uri.split('/').pop();
      this.exists = !this.uri.includes('missing');
    }
    write() {}
    delete() {}
    async bytes() {
      return AUDIO;
    }
    async base64() {
      return 'UklGRg==';
    }
    async copy() {}
  }
  class Directory {
    constructor(...parts) {
      this.uri = parts.map((p) => p.uri ?? p).join('/');
      this.exists = true;
    }
    create() {}
  }
  return { Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///docs' } }, File, Directory };
});

// expo-clipboard เป็น native module — test ตรวจแค่ว่าเรียกด้วยข้อความอะไร
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => '') }));

// expo/fetch (ใช้กับคำตอบแบบไหล) → ส่งต่อให้ global fetch ตอนเรียก เพื่อให้ mockFetch ของ test ดักได้
jest.mock('expo/fetch', () => ({ fetch: (...args) => global.fetch(...args) }));

// ตัวเลือกรูป/ไฟล์ — test กำหนดผลเองด้วย mockResolvedValueOnce
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

// แจ้งเตือน / ปฏิทิน / รายชื่อ — native ทั้งหมด · ค่าเริ่มต้น = ได้สิทธิ์ ไม่มีข้อมูล
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => 'notif-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-calendar/legacy', () => ({
  EntityTypes: { EVENT: 'event' },
  getCalendarPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCalendarPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCalendarsAsync: jest.fn(async () => []),
  getEventsAsync: jest.fn(async () => []),
  createEventAsync: jest.fn(async () => 'event-1'),
}));
jest.mock('expo-contacts/legacy', () => ({
  Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers', Emails: 'emails' },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getContactsAsync: jest.fn(async () => ({ data: [] })),
}));

// ถอดเสียงในเครื่อง — ค่าเริ่มต้น "ไม่มีบริการ" ให้ test เดิม (อัดไฟล์ + STT คลาวด์) ทำงานเหมือนเดิม
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => false),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
}));
