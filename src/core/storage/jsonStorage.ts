import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseJSON, type Guard } from '../types/guards';

/**
 * Typed JSON over AsyncStorage. Reads are validated with a guard instead of trusted with a cast:
 * a missing key, malformed JSON or a value that fails the guard all come back as `null`.
 * Storage failures (I/O, quota) are not swallowed here — callers decide how to degrade.
 */

export async function readJSON<T>(key: string, guard: Guard<T>): Promise<T | null> {
  return parseJSON(await AsyncStorage.getItem(key), guard);
}

export async function writeJSON<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
