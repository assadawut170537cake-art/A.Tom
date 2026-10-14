/**
 * Runtime type guards for data that crosses a trust boundary (storage, network, LLM output,
 * WebView messages). Prefer these over `as` casts: they narrow only after checking.
 */

export type Guard<T> = (value: unknown) => value is T;

/** Plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` is one of the literal members of `list`. */
export function isOneOf<const T extends readonly unknown[]>(list: T, value: unknown): value is T[number] {
  return list.includes(value);
}

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Parse JSON text; `null` when absent, malformed, or rejected by the guard. Never throws. */
export function parseJSON<T>(raw: string | null | undefined, guard: Guard<T>): T | null {
  if (raw == null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

/** Object.keys with the object's own key type (keys of a literal/const table only). */
export function keysOf<T extends object>(obj: T): (keyof T)[] {
  // Object.keys is typed string[] because objects may carry extra runtime keys; for the
  // module-local literal tables this is used on, the keys are exactly keyof T.
  return Object.keys(obj) as (keyof T)[];
}

/** Any array, typed `unknown[]` (Array.isArray narrows to `any[]`). */
export const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** Array whose every element passes `guard`. */
export function isArrayOf<T>(value: unknown, guard: Guard<T>): value is T[] {
  return Array.isArray(value) && value.every((v) => guard(v));
}
