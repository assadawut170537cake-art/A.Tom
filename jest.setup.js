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
  }
  return { Paths: { cache: { uri: 'file:///cache' } }, File };
});
