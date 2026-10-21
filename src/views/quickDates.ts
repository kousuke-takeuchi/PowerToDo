import { addDays, weekdayIndex } from "../mock/data";

/** 日付の早見 (今日 / 明日 / 今週末 = 次の土曜 / 来週 = 次の月曜)。DatePicker と DateSheet が同じ計算を使う。 */
export function quickDates(today: string): { today: string; tomorrow: string; weekend: string; nextWeek: string } {
  return {
    today,
    tomorrow: addDays(today, 1),
    weekend: addDays(today, (6 - weekdayIndex(today) + 7) % 7 || 7),
    nextWeek: addDays(today, ((1 - weekdayIndex(today) + 7) % 7) || 7),
  };
}
