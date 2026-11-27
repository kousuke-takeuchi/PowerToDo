import { minuteChoices, nextRoundTime, timeOf } from "../app/timeChoices";
import { nowTime } from "../views/dueLabel";

const field = { fontFamily: "var(--font-body)", color: "var(--color-text-primary)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer" } as const;

/**
 * A time of day, picked in 5-minute steps (spec 2026-11-28): an hour and a minute (native pickers, so the iPhone shows its wheel). With no
 * time yet there is only 「時刻を追加」, which starts at the next round time after now (9:45 gives 10:00). A minute that is not a multiple of
 * 5 (typed in the date field) stays in the list. 「なし」 takes the time off.
 */
export function TimeSelect({ value, onChange, size = 14, height = 32, now = nowTime }: { value?: string; onChange: (t: string | undefined) => void; size?: number; height?: number; now?: () => string }) {
  if (!value) {
    return (
      <button type="button" onClick={() => onChange(nextRoundTime(now()))} className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={{ ...field, height, padding: "0 10px", fontSize: size, color: "var(--color-accent)" }}>
        時刻を追加
      </button>
    );
  }
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  const select = { ...field, height, padding: "0 6px", fontSize: size } as const;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <select aria-label="時" value={hour} onChange={(e) => onChange(timeOf(Number(e.target.value), minute))} style={select}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span aria-hidden>:</span>
      <select aria-label="分" value={minute} onChange={(e) => onChange(timeOf(hour, Number(e.target.value)))} style={select}>
        {minuteChoices(minute).map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <button type="button" aria-label="時刻を外す" onClick={() => onChange(undefined)} className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={{ border: 0, borderRadius: 6, height, padding: "0 8px", fontFamily: "var(--font-body)", fontSize: size, color: "var(--color-text-secondary)", cursor: "pointer" }}>
        なし
      </button>
    </span>
  );
}
