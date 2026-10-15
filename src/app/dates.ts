// App code imports date math from here, not from the Storybook mock module.
export { addDays, daysBetween, monthDay, weekdayLong } from "../mock/data";

/** First day of the month `offsetMonths` away from `ymd`'s month, as YYYY-MM-DD. */
export function monthStart(ymd: string, offsetMonths: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(y, m - 1 + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const pad2 = (v: number) => String(v).padStart(2, "0");

/** Local date of `d` as YYYY-MM-DD. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local date and time of `d` as YYYY-MM-DDTHH:MM (the form `snooze_reminder` takes). */
export function localDateTime(d: Date): string {
  return `${localYmd(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 「10/20 15:00」「10/20」 (a different year than `today` adds it: 「2027/1/5 15:00」). `due` is YYYY-MM-DD, `dueTime` HH:MM. */
export function formatDue(due: string, dueTime: string | null | undefined, today: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const sameYear = !today || String(y) === today.slice(0, 4);
  const date = sameYear ? `${m}/${d}` : `${y}/${m}/${d}`;
  return dueTime ? `${date} ${dueTime}` : date;
}

/** 「後で」の選択肢: 10 分 / 1 時間 / 明日の通知時刻 ("HH:MM", 既定 09:00) を、ローカルの YYYY-MM-DDTHH:MM で返す。 */
export function snoozeChoices(now: Date, notifyTime: string): { label: string; until: string }[] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(notifyTime);
  const [h, min] = m ? [Number(m[1]), Number(m[2])] : [9, 0];
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, min);
  return [
    { label: "10 分", until: localDateTime(new Date(now.getTime() + 10 * 60_000)) },
    { label: "1 時間", until: localDateTime(new Date(now.getTime() + 60 * 60_000)) },
    { label: `明日 ${h}:${pad2(min)}`, until: localDateTime(tomorrow) },
  ];
}
