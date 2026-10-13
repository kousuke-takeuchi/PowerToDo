import type { Task, Project, Label, Section, Comment } from "../types/model";

export const TODAY = "2026-10-13"; // 火曜

export const projects: Project[] = [
  { name: "受信トレイ", color: "var(--color-text-muted)", order: 0, favorite: false, inbox: true },
  { name: "仕事", color: "var(--color-priority-3)", order: 1, favorite: false, inbox: false },
  { name: "買い物", color: "var(--color-priority-2)", order: 2, favorite: true, inbox: false },
  { name: "家のこと", color: "var(--color-success)", order: 3, favorite: false, inbox: false },
  { name: "読書", color: "var(--color-priority-4)", order: 4, favorite: false, inbox: false },
];

export const labels: Label[] = [
  { name: "食品", color: "var(--color-success)", order: 0 }, { name: "日用品", color: "var(--color-priority-3)", order: 1 },
  { name: "急ぎ", color: "var(--color-priority-1)", order: 2 }, { name: "キッチン", color: "var(--color-priority-2)", order: 3 },
];

export const sections: Section[] = [ { project: "買い物", name: "今週", order: 0 }, { project: "買い物", name: "いつか", order: 1 } ];

export const tasks: Task[] = [
  { no: 1, project: "買い物", category: "今週", title: "牛乳と卵を買う", assignee: "たろう", priority: 1, progress: 0, due: "2026-10-14", dueTime: "15:00", note: "近所のスーパーで。卵は 10 個入り", labels: ["食品"], rrule: "FREQ=WEEKLY;BYDAY=SA", reminders: ["-0m","-30m"], order: 0, createdAt: "2026-10-10T09:00" },
  { no: 2, project: "買い物", category: "今週", title: "洗剤の詰め替え", assignee: "たろう", priority: 3, progress: 0, due: "2026-10-17", labels: ["日用品"], reminders: [], order: 1, createdAt: "2026-10-10T09:00" },
  { no: 3, project: "買い物", category: "いつか", title: "新しいフライパン", assignee: "たろう", priority: 4, progress: 0, note: "28cm、IH 対応", labels: ["キッチン"], reminders: [], order: 0, createdAt: "2026-10-10T09:00" },
  { no: 4, project: "買い物", category: "今週", title: "牛乳 1L", assignee: "たろう", priority: 4, progress: 100, parentNo: 1, labels: [], reminders: [], order: 0, createdAt: "2026-10-10T09:00", completedAt: "2026-10-12T20:00" },
  { no: 5, project: "買い物", category: "今週", title: "卵 10 個入り", assignee: "たろう", priority: 4, progress: 0, parentNo: 1, labels: [], reminders: [], order: 1, createdAt: "2026-10-10T09:00" },
  { no: 6, project: "買い物", category: "今週", title: "卵は 10 個入り (特売)", assignee: "たろう", priority: 4, progress: 0, parentNo: 5, labels: [], reminders: [], order: 0, createdAt: "2026-10-10T09:00" },
  { no: 7, project: "買い物", category: "今週", title: "食パン", assignee: "たろう", priority: 4, progress: 0, parentNo: 1, labels: [], reminders: [], order: 2, createdAt: "2026-10-10T09:00" },
  { no: 8, project: "買い物", category: "今週", title: "食パンを買う", assignee: "たろう", priority: 4, progress: 0, due: "2026-10-13", labels: ["食品"], reminders: [], order: 2, createdAt: "2026-10-10T09:00" },
  { no: 9, project: "仕事", category: null, title: "請求書を送る", assignee: "たろう", priority: 2, progress: 0, due: "2026-10-10", labels: [], reminders: [], order: 0, createdAt: "2026-10-01T09:00" },
  { no: 10, project: "家のこと", category: null, title: "歯医者の予約", assignee: "たろう", priority: 3, progress: 0, due: "2026-10-12", labels: [], reminders: [], order: 0, createdAt: "2026-10-01T09:00" },
  { no: 11, project: "仕事", category: null, title: "週報を書く", assignee: "たろう", priority: 2, progress: 0, due: "2026-10-13", labels: [], reminders: [], order: 1, createdAt: "2026-10-01T09:00" },
  { no: 12, project: "家のこと", category: null, title: "ゴミ出し (燃えるごみ)", assignee: "たろう", priority: 4, progress: 0, due: "2026-10-13", labels: [], reminders: [], order: 1, createdAt: "2026-10-01T09:00" },
  { no: 13, project: "家のこと", category: null, title: "粗大ごみの申し込み", assignee: "たろう", priority: 3, progress: 0, due: "2026-10-14", labels: [], reminders: [], order: 2, createdAt: "2026-10-01T09:00" },
  { no: 14, project: "読書", category: null, title: "読書会の課題本を読み終える", assignee: "たろう", priority: 4, progress: 0, due: "2026-10-16", labels: [], reminders: [], order: 0, createdAt: "2026-10-01T09:00" },
  { no: 15, project: "家のこと", category: null, title: "調味料の補充", assignee: "たろう", priority: 4, progress: 0, due: "2026-10-13", labels: ["食品"], reminders: [], order: 3, createdAt: "2026-10-01T09:00" },
  { no: 17, project: "買い物", category: "今週", title: "洗剤 (詰め替え用)", assignee: "たろう", priority: 4, progress: 0, parentNo: 2, labels: [], reminders: [], order: 0, createdAt: "2026-10-10T09:00" },
  { no: 18, project: "買い物", category: "今週", title: "柔軟剤", assignee: "たろう", priority: 4, progress: 0, parentNo: 2, labels: [], reminders: [], order: 1, createdAt: "2026-10-10T09:00" },
  { no: 16, project: "買い物", category: "完了", title: "ティッシュ", assignee: "たろう", priority: 4, progress: 100, labels: [], reminders: [], order: 0, createdAt: "2026-10-01T09:00", completedAt: "2026-10-11T10:00" },
];

export type Counts = { inbox: number; today: number; [project: string]: number };
export const counts: Counts = { inbox: 12, today: 5, 仕事: 8, 買い物: 4, 家のこと: 3, 読書: 2 }; // サイドバーの件数表示 (pen と同じ固定値)

export const filters = [
  { name: "今日 + 優先度高", count: 3, color: "var(--color-accent)" },
  { name: "買い物 (今週)", count: 4, color: "var(--color-priority-2)" },
];

export const labelCounts: Record<string, number> = { 食品: 3, 日用品: 3, 急ぎ: 2, キッチン: 1 }; // pen D-06 の固定値

export const comments: Comment[] = [{ taskNo: 1, author: "たろう", at: "10/12 21:30", text: "先週は売り切れだった。開店直後に行く。" }]; // pen D-03 のコメント

export const LONG_TITLE = "来週の出張の準備として、ホテルと新幹線の予約を確認し、必要な書類を印刷してカバンに入れておく。名刺の残りも確認して補充する";

function toDayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** TODAY 基準の期限表示: 昨日 / 今日 / 明日 / 今週末 / M月D日。期限切れは danger。 */
export function dateLabel(due?: string, today: string = TODAY): { label: string; tone: "success" | "danger" | "muted" } | undefined {
  if (!due) return undefined;
  const diff = toDayNumber(due) - toDayNumber(today);
  if (diff === -1) return { label: "昨日", tone: "danger" };
  if (diff === 0) return { label: "今日", tone: "success" };
  if (diff === 1) return { label: "明日", tone: "success" };
  const [, m, d] = due.split("-").map(Number);
  const isSaturday = (toDayNumber(due) + 4) % 7 === 6; // epoch day 0 は木曜
  if (diff >= 2 && diff <= 7 && isSaturday) return { label: "今週末", tone: "success" };
  return { label: `${m}月${d}日`, tone: diff < 0 ? "danger" : "muted" };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 曜日 (日=0 ... 土=6)。 */
export function weekdayIndex(ymd: string): number {
  return (toDayNumber(ymd) + 4) % 7; // epoch day 0 は木曜
}

/** "月曜日" 形式。 */
export function weekdayLong(ymd: string): string {
  return `${WEEKDAYS[weekdayIndex(ymd)]}曜日`;
}

/** "火" 形式。 */
export function weekdayShort(ymd: string): string {
  return WEEKDAYS[weekdayIndex(ymd)];
}

/** "10月13日" 形式。 */
export function monthDay(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日`;
}

/** ymd に n 日を足した ymd。 */
export function addDays(ymd: string, n: number): string {
  const dt = new Date((toDayNumber(ymd) + n) * 86_400_000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 日数差 (a - b)。 */
export function daysBetween(a: string, b: string): number {
  return toDayNumber(a) - toDayNumber(b);
}
