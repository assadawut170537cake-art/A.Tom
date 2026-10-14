/**
 * Element `index` of a list, failing the test with a readable message when it doesn't exist.
 * Used instead of `list[i]!` now that noUncheckedIndexedAccess types `list[i]` as `T | undefined`.
 * Negative indexes count from the end, like Array.prototype.at.
 */
export function nth<T>(list: readonly T[], index: number): T {
  const value = list.at(index);
  if (value === undefined) {
    throw new Error(`Expected an element at index ${index}, but the list has ${list.length}`);
  }
  return value;
}
