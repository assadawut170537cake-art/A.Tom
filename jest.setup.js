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
}));

jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class {
    constructor(...parts) {
      this.uri = parts.map((p) => p.uri ?? p).join('/');
      this.name = this.uri.split('/').pop();
      this.exists = true;
    }
    write() {}
    delete() {}
  },
}));
