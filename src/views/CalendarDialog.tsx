import { useEffect } from "react";
import { Check } from "lucide-react";
import { api } from "../api/client";
import { useEscLayer } from "../app/layers";
import { isSelected, type CalendarChooserApi } from "../app/useCalendarChooser";
import { Button } from "../components/Button";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 10px",
  border: 0,
  borderRadius: 6,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  lineHeight: "20px",
  textAlign: "left",
  color: "var(--color-text-primary)",
  cursor: "pointer",
} as const;

/**
 * The 「Google カレンダー」 dialog of a project (spec 2026-11-27): the calendars shown now (click one to stop), then an account
 * (the ones logged in on this device, or add one) and its calendars, each a check that is saved at once. Several calendars of several
 * accounts can be shown. Display only: the project lists their events above its tasks.
 */
export function CalendarDialog({ project, chooser, onClose }: { project: string; chooser: CalendarChooserApi; onClose: () => void }) {
  const { accounts, account, setAccount, calendars, busy, error, selected, addAccount, toggle, remove } = chooser;
  useEscLayer(true, onClose);
  // A login still waiting is cancelled when the dialog goes.
  useEffect(() => () => void api.googleLoginCancel().catch(() => undefined), []);
  const dot = (color?: string) => <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: color || "var(--color-text-secondary)", flex: "0 0 auto" }} />;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Google カレンダー" style={{ width: 440, maxHeight: "70vh", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "20px 16px 16px", borderRadius: 10, background: "var(--color-bg)", boxShadow: "var(--shadow-dialog)", fontFamily: "var(--font-body)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px", color: "var(--color-text-primary)" }}>「{project}」の Google カレンダー</div>
        <div style={{ marginTop: 4, fontSize: 12, lineHeight: "18px", color: "var(--color-text-secondary)" }}>選んだカレンダーの予定を、このプロジェクトの一覧に表示します。複数のカレンダー、複数のアカウントを選べます (表示だけです)。</div>
        <div style={{ marginTop: 12, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {error && (
            <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)", padding: "4px 10px" }}>
              {error}
            </div>
          )}
          {selected.length > 0 && (
            <>
              <div style={{ padding: "0 10px 2px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>表示しているカレンダー (押すと外す)</div>
              {selected.map((l) => (
                <button key={`${l.account}|${l.calendarId}`} type="button" aria-label={`${l.name || l.calendarId} を外す`} style={rowStyle} className="bg-transparent hover:bg-[var(--color-bg-hover)]" onClick={() => void remove(l)}>
                  {dot(l.color)}
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{l.name || l.calendarId}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.account}</span>
                  <Check size={16} aria-hidden />
                </button>
              ))}
              <div style={{ height: 8 }} />
            </>
          )}
          <div style={{ padding: "0 10px 2px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>{account === null ? "カレンダーを足す (アカウントを選ぶ)" : account}</div>
          {account === null ? (
            <>
              {accounts.map((a) => (
                <button key={a} type="button" style={rowStyle} className="bg-transparent hover:bg-[var(--color-bg-hover)]" onClick={() => setAccount(a)}>
                  {a}
                </button>
              ))}
              {busy && <div style={{ padding: "4px 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>Google のログインを待っています… (開いたブラウザで許可してください)</div>}
            </>
          ) : calendars === null ? (
            <div style={{ padding: "4px 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>{busy ? "カレンダーを読み込んでいます…" : ""}</div>
          ) : calendars.length === 0 ? (
            <div style={{ padding: "4px 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>読めるカレンダーがありません</div>
          ) : (
            calendars.map((c) => {
              const on = isSelected(selected, account, c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} style={rowStyle} className="bg-transparent hover:bg-[var(--color-bg-hover)]" onClick={() => void toggle(c)}>
                  {dot(c.color)}
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{c.name}</span>
                  {on && <Check size={16} aria-label="選択中" />}
                </button>
              );
            })
          )}
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
          {account === null ? (
            <Button variant="secondary" onClick={() => void addAccount()} disabled={busy}>
              {accounts.length > 0 ? "別のアカウントを追加" : "Google アカウントを追加"}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setAccount(null)}>
              別のアカウントを選ぶ
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
