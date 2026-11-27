/** The reminder code 「時刻ちょうど」 (reminders.rs: `-0m`, minutes before the due time). */
export const AT_TIME = "-0m";

/**
 * iPhone (spec 2026-11-27): a task given a time of day gets the reminder 「時刻ちょうど」 so it notifies without a
 * separate step. A task that already has reminders keeps them (the owner chose them); no time adds nothing.
 */
export function remindersWithTime(current: string[], dueTime: string | null | undefined): string[] | undefined {
  if (!dueTime || current.length > 0) return undefined;
  return [AT_TIME];
}
