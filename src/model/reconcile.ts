export function reconcileByKey<T>(
  current: readonly T[],
  next: readonly T[],
  key: (value: T) => string,
  update: (current: T, next: T) => void
): { readonly values: readonly T[]; readonly structureChanged: boolean } {
  const existing = new Map(current.map(value => [key(value), value]));
  let structureChanged = current.length !== next.length;
  const values = next.map(candidate => {
    const value = existing.get(key(candidate));
    if (!value) {
      structureChanged = true;
      return candidate;
    }
    update(value, candidate);
    return value;
  });
  return { values, structureChanged };
}
