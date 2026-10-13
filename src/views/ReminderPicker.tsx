import { useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import { Segmented } from "../components/Segmented";
import { PopRow, PopoverShell } from "./PopoverShell";

export type ReminderPickerProps = {
  reminders: string[];
  onChange?: (r: string[]) => void;
  /** 期限の時刻 (既定 "15:00")。追加済みの行の括弧内の時刻の基準。 */
  dueTime?: string;
};

/** 追加済みの表示用ラベルの元になる定義。code は task.reminders の値 ("-30m" = 30 分前)。 */
const OPTIONS = [
  { code: "-0m", added: "期限と同時刻", short: "同時刻", minutes: 0 },
  { code: "-10m", added: "10 分前", short: "10 分前", minutes: 10 },
  { code: "-30m", added: "30 分前", short: "30 分前", minutes: 30 },
  { code: "-60m", added: "1 時間前", short: "1 時間前", minutes: 60 },
  { code: "-1d", added: "前日 9:00", short: "前日 9:00" },
  { code: "-1w", added: "1 週間前", short: "1 週間前" },
] as const;

/** 候補に並べるもの (pen の順)。 */
const CANDIDATES = ["-10m", "-60m", "-1d", "-1w"];

const optionOf = (code: string) => OPTIONS.find((o) => o.code === code);

const pad = (n: number) => String(n).padStart(2, "0");
function minus(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const t = (((h * 60 + m - minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** D-03 の「リマインダー」行の値 ("2 件 (同時刻, 30 分前)")。 */
export function reminderSummary(reminders: string[]): string {
  if (reminders.length === 0) return "なし";
  return `${reminders.length} 件 (${reminders.map((c) => optionOf(c)?.short ?? c).join(", ")})`;
}

/** D-08: リマインダーポップオーバーの中身。候補を押すと追加済みへ移り、x で候補へ戻る。 */
export function ReminderPicker({ reminders, onChange, dueTime = "15:00" }: ReminderPickerProps) {
  const [added, setAdded] = useState<string[]>(reminders);
  const [mode, setMode] = useState<"due" | "at">("due");
  const update = (next: string[]) => {
    setAdded(next);
    onChange?.(next);
  };
  const addedLabel = (code: string) => {
    const o = optionOf(code);
    if (!o) return code;
    return "minutes" in o ? `${o.added} (${minus(dueTime, o.minutes)})` : o.added;
  };
  const heading = { fontSize: 12, lineHeight: "17px", fontWeight: 700, color: "var(--color-text-secondary)" } as const;
  const label = { flex: 1, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" } as const;
  return (
    <PopoverShell label="リマインダー" gap="var(--space-2)">
      <Segmented
        options={[
          { value: "due", label: "期限から" },
          { value: "at", label: "日時指定" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <span style={heading}>追加済み</span>
      {added.map((code) => (
        <PopRow key={code} icon={<Bell size={16} />} iconColor="var(--color-accent)">
          <span style={label}>{addedLabel(code)}</span>
          <button
            type="button"
            aria-label={`${optionOf(code)?.added ?? code}を削除`}
            onClick={() => update(added.filter((c) => c !== code))}
            style={{ display: "inline-flex", padding: 0, border: 0, background: "none", color: "var(--color-text-muted)", cursor: "pointer" }}
          >
            <X size={14} />
          </button>
        </PopRow>
      ))}
      <span style={heading}>候補</span>
      {CANDIDATES.filter((c) => !added.includes(c)).map((code) => (
        <PopRow key={code} icon={<Plus size={16} />} onClick={() => update([...added, code])}>
          <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>{optionOf(code)?.added}</span>
        </PopRow>
      ))}
    </PopoverShell>
  );
}
