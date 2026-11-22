import type { Span, TokenKind } from "../types/model";

export type InsertKind = "date" | "priority" | "label" | "project";

/** ツールバーが入力欄の末尾に足す語 (構文はデスクトップのクイック追加と同じ。リマインダーは構文が無いので別のシートで選ぶ。ラベルは "@"、プロジェクトは "#" だけ足して名前を続けて打たせる)。 */
export const INSERT_WORDS: Record<InsertKind, string> = { date: "明日", priority: "p1", label: "@", project: "#" };

/** 入力欄の文字の末尾に構文の語を足す。直前が空白 (または空) でなければ半角スペースを 1 つ挟む。 */
export function insertToken(text: string, kind: InsertKind): string {
  const sep = text === "" || /\s$/.test(text) ? "" : " ";
  return `${text}${sep}${INSERT_WORDS[kind]}`;
}

/**
 * The quick add's pickers (spec 2026-11-22 §1): drops the words of `kinds` (located by the spans `parse_quick_add` returned
 * for this very text; offsets are code points) and appends `words`. Spaces left behind collapse to one.
 */
export function replaceWords(text: string, spans: Span[], kinds: TokenKind[], words: string[]): string {
  const chars = Array.from(text);
  const drop = new Array<boolean>(chars.length).fill(false);
  for (const s of spans) {
    if (!kinds.includes(s.kind) || s.start < 0 || s.end > chars.length) continue;
    for (let i = s.start; i < s.end; i++) drop[i] = true;
  }
  const kept = chars
    .filter((_, i) => !drop[i])
    .join("")
    .replace(/[ 　]{2,}/g, " ")
    .trim();
  return [kept, ...words].filter((w) => w !== "").join(" ");
}

/** The quick add words for a picked date (and time): 今日 / 明日 by name, else M/D this year or YYYY/M/D. */
export function dateWords(date: string | undefined, time: string | undefined, today: string): string[] {
  if (!date) return [];
  const [y, m, d] = date.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 1)).toISOString().slice(0, 10);
  const day = date === today ? "今日" : date === tomorrow ? "明日" : y === Number(today.slice(0, 4)) ? `${m}/${d}` : `${y}/${m}/${d}`;
  return time ? [day, `${Number(time.slice(0, 2))}:${time.slice(3, 5)}`] : [day];
}

/** `#name`, quoted when the name has a space (the parser reads `#"..."`). */
export function projectWord(name: string): string {
  return /\s/.test(name) ? `#"${name}"` : `#${name}`;
}
