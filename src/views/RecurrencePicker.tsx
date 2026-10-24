import type React from "react";
import { useEffect, useRef, useState } from "react";
import { isImeKey } from "../app/keys";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { PopRow, PopoverShell } from "./PopoverShell";

export type RecurrenceParse = { rrule: string | null; label: string | null };

export type RecurrencePickerProps = {
  value?: string;
  onChange?: (rrule?: string) => void;
  /** 入力欄の初期表示 (value の要約)。無ければ recurrenceLabel(value)。 */
  valueLabel?: string;
  /** 渡すと、入力が 300ms 止まったところで呼んで解釈結果をプレビューし、Enter で選択する。無ければ従来どおり。 */
  onParse?: (text: string) => Promise<RecurrenceParse>;
  /** 入力欄の文字の大きさ (px)。モバイルのシートは 16 (iOS の拡大を避ける)。省略すると 14。 */
  fontSize?: number;
};

const PARSE_DELAY_MS = 300;

export const RECURRENCE_PRESETS = [
  { label: "毎日", short: "毎日", rrule: "FREQ=DAILY" },
  { label: "平日", short: "平日", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "毎週 (土曜)", short: "毎週土曜", rrule: "FREQ=WEEKLY;BYDAY=SA" },
  { label: "毎月 (18日)", short: "毎月18日", rrule: "FREQ=MONTHLY;BYMONTHDAY=18" },
  { label: "毎年 (10月18日)", short: "毎年10月18日", rrule: "FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18" },
  { label: "完了日から 3 日ごと", short: "完了日から 3 日ごと", rrule: "FREQ=DAILY;INTERVAL=3", note: " (完了基準)" },
] as const;

/** RRULE を画面表示用の短い文言にする (D-03 の「繰り返し」行)。未設定は "なし"。 */
export function recurrenceLabel(rrule?: string): string {
  return RECURRENCE_PRESETS.find((p) => p.rrule === rrule)?.short ?? (rrule ? rrule : "なし");
}

/** D-07b: 繰り返しポップオーバーの中身。選択は内部状態、適用 / 解除は onChange で通知する。 */
export function RecurrencePicker({ value, onChange, valueLabel, onParse, fontSize }: RecurrencePickerProps) {
  const [rrule, setRrule] = useState<string | undefined>(value);
  const [rruleLabel, setRruleLabel] = useState<string | undefined>(value ? valueLabel : undefined);
  const [typed, setTyped] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecurrenceParse | null>(null);
  // IME の変換中は解釈しない (確定してから)。
  const [composing, setComposing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const current = rrule ? (rruleLabel ?? recurrenceLabel(rrule)) : "";

  // 古い応答は捨てる: 呼ぶたびに番号を進め、返ってきたときの番号が最新のものだけ採用する。
  const seq = useRef(0);
  const parseRef = useRef(onParse);
  parseRef.current = onParse;
  const run = async (text: string): Promise<RecurrenceParse | null> => {
    const parse = parseRef.current;
    if (!parse) return null;
    const n = ++seq.current;
    let r: RecurrenceParse;
    try {
      r = await parse(text);
    } catch {
      r = { rrule: null, label: null };
    }
    return n === seq.current ? r : null;
  };
  useEffect(() => {
    seq.current += 1;
    setPreview(null);
    if (!parseRef.current || typed === null || typed.trim() === "" || composing) return;
    timer.current = window.setTimeout(() => void run(typed).then((r) => r && setPreview(r)), PARSE_DELAY_MS);
    return () => {
      window.clearTimeout(timer.current);
      seq.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, composing]);
  const select = (r: string, label?: string) => {
    setRrule(r);
    setRruleLabel(label);
    setTyped(null);
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!onParse || e.key !== "Enter" || isImeKey(e) || typed === null || typed.trim() === "") return;
    e.preventDefault();
    window.clearTimeout(timer.current);
    void run(typed).then((r) => {
      if (r?.rrule) select(r.rrule, r.label ?? undefined);
      else if (r) setPreview(r);
    });
  };
  return (
    <PopoverShell label="繰り返し" gap="var(--space-2)">
      <TextField
        fontSize={fontSize}
        value={typed ?? current}
        placeholder="繰り返しを入力"
        onChange={setTyped}
        onKeyDown={onParse ? onEnter : undefined}
        onCompositionStart={onParse ? () => setComposing(true) : undefined}
        onCompositionEnd={onParse ? () => setComposing(false) : undefined}
      />
      {preview && (
        <div
          aria-live="polite"
          style={{ fontSize: 12, lineHeight: "17px", color: preview.rrule ? "var(--color-text-secondary)" : "var(--color-text-muted)" }}
        >
          {preview.rrule ? `→ ${preview.label ?? preview.rrule}` : "解釈できません"}
        </div>
      )}
      {RECURRENCE_PRESETS.map((p) => (
        <PopRow
          key={p.rrule}
          selected={p.rrule === rrule}
          onClick={() => select(p.rrule)}
        >
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>{p.label}</span>
            <span style={{ fontSize: 10, lineHeight: "14px", color: "var(--color-text-muted)" }}>
              {p.rrule}
              {"note" in p ? p.note : ""}
            </span>
          </span>
        </PopRow>
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", paddingTop: 8 }}>
        <Button
          variant="secondary"
          onClick={() => {
            setRrule(undefined);
            setRruleLabel(undefined);
            setTyped(null);
            onChange?.(undefined);
          }}
        >
          解除
        </Button>
        <Button variant="primary" onClick={() => onChange?.(preview?.rrule ?? rrule)}>
          適用
        </Button>
      </div>
    </PopoverShell>
  );
}
