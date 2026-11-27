import { Check, CalendarDays, CircleUserRound, Plus } from "lucide-react";
import { isSelected, type CalendarChooserApi } from "../../app/useCalendarChooser";
import { SheetCard, SheetRow } from "./BottomSheet";

export type CalendarSheetProps = { chooser: CalendarChooserApi };

const head = { padding: "8px 4px 4px", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-secondary)" } as const;
const note = { padding: "8px 4px", fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" } as const;

/**
 * Spec 2026-11-27: the sheet of a project's 「Google カレンダー」. The calendars shown now are listed first (a tap stops showing one);
 * below, an account (this device's logged-in ones, or 「アカウントを追加」) and then that account's calendars, each a check that
 * is saved at once. Several calendars of several accounts can be shown; the sheet stays open until the x.
 */
export function CalendarSheet({ chooser }: CalendarSheetProps) {
  const { accounts, account, setAccount, calendars, busy, error, selected, addAccount, toggle, remove } = chooser;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {error && (
        <div role="alert" style={{ ...note, color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
      {selected.length > 0 && (
        <>
          <div style={head}>表示しているカレンダー</div>
          <SheetCard label="表示しているカレンダー">
            {selected.map((l) => (
              <SheetRow key={`${l.account}|${l.calendarId}`} icon={<Check size={18} />} iconColor={l.color || undefined} label={l.name || l.calendarId} value={l.account} onClick={() => void remove(l)} />
            ))}
          </SheetCard>
        </>
      )}
      {account === null ? (
        <>
          <div style={head}>カレンダーを足す (アカウント)</div>
          <SheetCard label="アカウント">
            {accounts.map((a) => (
              <SheetRow key={a} icon={<CircleUserRound size={18} />} label={a} onClick={() => setAccount(a)} />
            ))}
            <SheetRow icon={<Plus size={18} />} label={accounts.length > 0 ? "別のアカウントを追加" : "Google アカウントを追加"} onClick={() => void addAccount()} />
          </SheetCard>
          {busy && <div style={note}>Google のログインを待っています…</div>}
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
                const on = isSelected(selected, account, c.id);
                return <SheetRow key={c.id} icon={on ? <Check size={18} /> : <CalendarDays size={18} />} iconColor={c.color} label={c.name} selected={on} onClick={() => void toggle(c)} />;
              })}
            </SheetCard>
          )}
          <div style={{ paddingTop: 12 }}>
            <SheetCard>
              <SheetRow label="別のアカウントを選ぶ" onClick={() => setAccount(null)} />
            </SheetCard>
          </div>
        </>
      )}
    </div>
  );
}
