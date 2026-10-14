/**
 * Run an async load from a useEffect and apply the result only while the component is still
 * mounted. Returns the effect cleanup: `useEffect(() => whileMounted(load, apply), deps)`.
 */
export function whileMounted<T>(load: () => Promise<T>, apply: (value: T) => void): () => void {
  let alive = true;
  load().then((value) => {
    if (alive) apply(value);
  });
  return () => {
    alive = false;
  };
}

/** Saved order first (ids that still exist), then any ids the saved order doesn't know yet. */
export function mergeOrder<T>(saved: readonly T[], current: readonly T[]): T[] {
  return [
    ...saved.filter((id) => current.includes(id)),
    ...current.filter((id) => !saved.includes(id)),
  ];
}
