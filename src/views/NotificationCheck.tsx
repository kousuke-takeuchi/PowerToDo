import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api/client";
import { Button } from "../components/Button";
import type { NotificationCheckDto } from "../types/model";
import { Desc, Row, Section } from "./SettingsPanes";

/**
 * 「通知の確認」 (iPhone settings): how many notifications the OS has scheduled, and a test one that arrives in 10 seconds
 * through the same path as the reminders. When a reminder does not come, this tells whether the OS has it.
 */
export function NotificationCheck({ active }: { active: boolean }) {
  const [check, setCheck] = useState<NotificationCheckDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    api.notificationCheck().then(setCheck, (e) => setMessage(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);
  if (!check?.supported) return null;
  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.notificationTest();
      setMessage("10 秒後にテスト通知が届きます。アプリを閉じて待ってください");
      refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section label="通知の確認">
      <Desc>
        {`iPhone に予約されている通知: ${check.scheduled} 件${check.permission === "granted" ? "" : " (通知が許可されていません)"}`}
        {check.titles.length > 0 ? ` (${check.titles.join("、")}${check.scheduled > check.titles.length ? " ほか" : ""})` : ""}
      </Desc>
      {check.error && (
        <div role="alert" style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-danger)" }}>
          {`予約の一覧を読めませんでした: ${check.error}`}
        </div>
      )}
      <Row>
        <Button variant="secondary" onClick={() => void test()} disabled={busy}>
          10 秒後にテスト通知
        </Button>
        <Button variant="secondary" onClick={refresh} disabled={busy}>
          読み直す
        </Button>
      </Row>
      {message && <Desc>{message}</Desc>}
    </Section>
  );
}
