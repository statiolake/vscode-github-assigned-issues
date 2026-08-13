export interface TimestampedSnapshot {
  readonly savedAt: number;
}

export function isFresh(
  snapshot: TimestampedSnapshot,
  refreshIntervalMinutes: number,
  now = Date.now()
): boolean {
  return refreshIntervalMinutes > 0 && now - snapshot.savedAt < refreshIntervalMinutes * 60 * 1000;
}
