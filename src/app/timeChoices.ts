/** The minutes a time can be picked at (spec 2026-11-28): every 5 minutes. A time typed by hand may be any minute. */
export const MINUTE_STEP = 5;
/** Where a new time starts: the next whole multiple of this many minutes after now (9:45 gives 10:00, 9:10 gives 9:30). */
export const START_STEP = 30;

const pad = (n: number) => String(n).padStart(2, "0");

/** The next round time after `now` (HH:MM): the start of a time that has none yet. Past 23:30 it stays at 23:55 (the same day). */
export function nextRoundTime(now: string): string {
  const minutes = Number(now.slice(0, 2)) * 60 + Number(now.slice(3, 5));
  const next = (Math.floor(minutes / START_STEP) + 1) * START_STEP;
  if (next >= 24 * 60) return "23:55";
  return `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
}

/** The minute choices (00, 05, ... 55), with `current` added when it is not one of them (a time typed as 9:03 stays selectable). */
export function minuteChoices(current?: number): number[] {
  const all = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
  return current === undefined || all.includes(current) ? all : [...all, current].sort((a, b) => a - b);
}

/** "HH:MM" from an hour and a minute. */
export const timeOf = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;
