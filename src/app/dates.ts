// App code imports date math from here, not from the Storybook mock module.
export { addDays, daysBetween, monthDay, weekdayLong } from "../mock/data";

/** First day of the month `offsetMonths` away from `ymd`'s month, as YYYY-MM-DD. */
export function monthStart(ymd: string, offsetMonths: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(y, m - 1 + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
