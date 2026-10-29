export type InsertKind = "date" | "priority" | "label" | "project";

/** ツールバーが入力欄の末尾に足す語 (構文はデスクトップのクイック追加と同じ。リマインダーは構文が無いので別のシートで選ぶ。ラベルは "@"、プロジェクトは "#" だけ足して名前を続けて打たせる)。 */
export const INSERT_WORDS: Record<InsertKind, string> = { date: "明日", priority: "p1", label: "@", project: "#" };

/** 入力欄の文字の末尾に構文の語を足す。直前が空白 (または空) でなければ半角スペースを 1 つ挟む。 */
export function insertToken(text: string, kind: InsertKind): string {
  const sep = text === "" || /\s$/.test(text) ? "" : " ";
  return `${text}${sep}${INSERT_WORDS[kind]}`;
}
