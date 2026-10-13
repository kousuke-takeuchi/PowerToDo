import { useState } from "react";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { PopRow, PopoverShell } from "./PopoverShell";

export type RecurrencePickerProps = { value?: string; onChange?: (rrule?: string) => void };

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
export function RecurrencePicker({ value, onChange }: RecurrencePickerProps) {
  const [rrule, setRrule] = useState<string | undefined>(value);
  const [typed, setTyped] = useState<string | null>(null);
  // pen では入力欄の "毎週土曜" は placeholder (muted)。選ぶ / 入力するまでは値を空にして placeholder で出す。
  const [touched, setTouched] = useState(false);
  const current = rrule ? recurrenceLabel(rrule) : "";
  return (
    <PopoverShell label="繰り返し" gap="var(--space-2)">
      <TextField value={typed ?? (touched ? current : "")} placeholder={current || "繰り返しを入力"} onChange={setTyped} />
      {RECURRENCE_PRESETS.map((p) => (
        <PopRow
          key={p.rrule}
          selected={p.rrule === rrule}
          onClick={() => {
            setRrule(p.rrule);
            setTyped(null);
            setTouched(true);
          }}
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
            setTyped(null);
            setTouched(true);
            onChange?.(undefined);
          }}
        >
          解除
        </Button>
        <Button variant="primary" onClick={() => onChange?.(rrule)}>
          適用
        </Button>
      </div>
    </PopoverShell>
  );
}
