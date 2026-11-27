import { Button } from "../components/Button";
import { Desc, Row, Section } from "./SettingsPanes";

export type CalendarAccountsPaneProps = {
  accounts: string[];
  /** A login or logout is running. */
  busy?: boolean;
  /** The browser (or the login sheet) is open and the app waits for Google. */
  waiting?: boolean;
  error?: string | null;
  onAdd?: () => void;
  onCancel?: () => void;
  onLogout?: (email: string) => void;
};

/**
 * The 「Google カレンダー」 settings (spec 2026-11-27): the Google accounts logged in for calendars on this device. They are separate from the
 * Drive sync's account; a project chooses one of them and one of its calendars from its 「…」 menu. Read-only access.
 */
export function CalendarAccountsPane({ accounts, busy, waiting, error, onAdd, onCancel, onLogout }: CalendarAccountsPaneProps) {
  return (
    <>
      <Desc>プロジェクトごとに、Google カレンダーの予定を一覧に表示できます。表示だけで、予定の追加や完了はしません。アカウントはプロジェクトごとに別でもかまいません。同期の Google ログインとは別です。</Desc>
      <Section label="ログインしているアカウント">
        {accounts.length === 0 && <Desc>まだありません</Desc>}
        {accounts.map((a) => (
          <Row key={a}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", overflowWrap: "anywhere", color: "var(--color-text-primary)" }}>{a}</span>
            <Button variant="secondary" onClick={() => onLogout?.(a)} disabled={busy}>
              ログアウト
            </Button>
          </Row>
        ))}
        <Row>
          {waiting ? (
            <Button variant="secondary" onClick={onCancel}>
              キャンセル
            </Button>
          ) : (
            <Button variant="secondary" onClick={onAdd} disabled={busy}>
              アカウントを追加
            </Button>
          )}
        </Row>
        {waiting && <Desc>開いたブラウザ (iPhone ではログインの画面) で、カレンダーの閲覧を許可してください。</Desc>}
        {error && (
          <div role="alert" style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-danger)" }}>
            {error}
          </div>
        )}
      </Section>
    </>
  );
}
