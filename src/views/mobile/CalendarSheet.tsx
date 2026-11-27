import { Check, CircleUserRound, CalendarDays, Plus, X } from "lucide-react";
import type { CalendarChooserApi } from "../../app/useCalendarChooser";
import type { CalendarLink } from "../../types/model";
import { SheetCard, SheetRow } from "./BottomSheet";

export type CalendarSheetProps = {
  chooser: CalendarChooserApi;
  /** The calendar the project shows now. */
  current: CalendarLink | null;
  onClose: () => void;
};

const head = { padding: "8px 4px 4px", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-secondary)" } as const;
const note = { padding: "8px 4px", fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" } as const;

/**
 * Spec 2026-11-27: the sheet of a project's 「Google カレンダー」. First the account (this device's logged-in ones, or 「アカウントを追加」),
 * then that account's calendars; a pick shows the calendar's events in the project (display only) and closes the sheet.
 */
export function CalendarSheet({ chooser, current, onClose }: CalendarSheetProps) {
  const { accounts, account, setAccount, calendars, busy, error, addAccount, pick, clear } = chooser;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {error && (
        <div role="alert" style={{ ...note, color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
      {account === null ? (
        <>
          <div style={head}>アカウント</div>
          <SheetCard label="アカウント">
            {accounts.map((a) => (
              <SheetRow key={a} icon={<CircleUserRound size={18} />} label={a} onClick={() => setAccount(a)} />
            ))}
            <SheetRow icon={<Plus size={18} />} label={accounts.length > 0 ? "別のアカウントを追加" : "Google アカウントを追加"} onClick={() => void addAccount()} />
          </SheetCard>
          {busy && <div style={note}>Google のログインを待っています…</div>}
          {current && (
            <div style={{ paddingTop: 12 }}>
              <SheetCard>
                <SheetRow
                  icon={<X size={18} />}
                  label={`「${current.name || current.calendarId}」を外す`}
                  danger
                  onClick={() => void clear().then((ok) => ok && onClose())}
                />
              </SheetCard>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={head}>{account}</div>
          {calendars === null ? (
            <div style={note}>{busy ? "カレンダーを読み込んでいます…" : ""}</div>
          ) : calendars.length === 0 ? (
            <div style={note}>読めるカレンダーがありません</div>
          ) : (
            <SheetCard label="カレンダー">
              {calendars.map((c) => {
                const on = current?.account === account && current.calendarId === c.id;
                return (
                  <SheetRow
                    key={c.id}
                    icon={on ? <Check size={18} /> : <CalendarDays size={18} />}
                    iconColor={c.color}
                    label={c.name}
                    selected={on}
                    onClick={() => void pick(c).then((ok) => ok && onClose())}
                  />
                );
              })}
            </SheetCard>
          )}
          <div style={{ paddingTop: 12 }}>
            <SheetCard>
              <SheetRow label="アカウントを変える" onClick={() => setAccount(null)} />
            </SheetCard>
          </div>
        </>
      )}
    </div>
  );
}
