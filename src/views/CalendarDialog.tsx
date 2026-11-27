import { useEffect } from "react";
import { Check } from "lucide-react";
import { api } from "../api/client";
import { useEscLayer } from "../app/layers";
import type { CalendarChooserApi } from "../app/useCalendarChooser";
import { Button } from "../components/Button";
import type { CalendarLink } from "../types/model";

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
 * The 「Google カレンダー」 dialog of a project (spec 2026-11-27): pick the account (the ones logged in on this device, or add one), then the
 * calendar to show; 「外す」 takes it off. Display only: the project then lists that calendar's events above its tasks.
 */
export function CalendarDialog({ project, chooser, current, onClose }: { project: string; chooser: CalendarChooserApi; current: CalendarLink | null; onClose: () => void }) {
  const { accounts, account, setAccount, calendars, busy, error, addAccount, pick, clear } = chooser;
  useEscLayer(true, onClose);
  // A login still waiting is cancelled when the dialog goes.
  useEffect(() => () => void api.googleLoginCancel().catch(() => undefined), []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Google カレンダー" style={{ width: 420, maxHeight: "70vh", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "20px 16px 16px", borderRadius: 10, background: "var(--color-bg)", boxShadow: "var(--shadow-dialog)", fontFamily: "var(--font-body)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px", color: "var(--color-text-primary)" }}>「{project}」の Google カレンダー</div>
        <div style={{ marginTop: 4, fontSize: 12, lineHeight: "18px", color: "var(--color-text-secondary)" }}>選んだカレンダーの予定を、このプロジェクトの一覧に表示します (表示だけです)。</div>
        <div style={{ marginTop: 12, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {error && (
            <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)", padding: "4px 10px" }}>
              {error}
            </div>
          )}
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
            <>
              <div style={{ padding: "0 10px 4px", fontSize: 12, color: "var(--color-text-secondary)" }}>{account}</div>
              {calendars.map((c) => {
                const on = current?.account === account && current.calendarId === c.id;
                return (
                  <button key={c.id} type="button" aria-pressed={on} style={rowStyle} className="bg-transparent hover:bg-[var(--color-bg-hover)]" onClick={() => void pick(c).then((ok) => ok && onClose())}>
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: c.color ?? "var(--color-text-secondary)", flex: "0 0 auto" }} />
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{c.name}</span>
                    {on && <Check size={16} aria-label="選択中" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {account === null ? (
              <Button variant="secondary" onClick={() => void addAccount()} disabled={busy}>
                {accounts.length > 0 ? "別のアカウントを追加" : "Google アカウントを追加"}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setAccount(null)}>
                アカウントを変える
              </Button>
            )}
            {current && account === null && (
              <Button variant="secondary" onClick={() => void clear().then((ok) => ok && onClose())} disabled={busy}>
                外す
              </Button>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
