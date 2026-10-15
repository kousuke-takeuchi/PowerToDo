import type { QuickAddToken } from "../views/QuickAddDialog";
import type { Span } from "../types/model";

/**
 * Splits `text` into plain and recognised parts from the spans `parse_quick_add` returned.
 * Span offsets are code point (Rust `char`) indices, not UTF-16 units, so the text is split with Array.from.
 * Time and recurrence spans are shown like a date. Spans that overlap or fall outside the text are skipped.
 */
export function spansToTokens(text: string, spans: Span[]): QuickAddToken[] {
  const chars = Array.from(text);
  const tokens: QuickAddToken[] = [];
  let pos = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < pos || s.end <= s.start || s.end > chars.length) continue;
    if (s.start > pos) tokens.push({ text: chars.slice(pos, s.start).join("") });
    tokens.push({ text: chars.slice(s.start, s.end).join(""), kind: s.kind === "time" || s.kind === "recurrence" ? "date" : s.kind });
    pos = s.end;
  }
  if (pos < chars.length) tokens.push({ text: chars.slice(pos).join("") });
  return tokens;
}
