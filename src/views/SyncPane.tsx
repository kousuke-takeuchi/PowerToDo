import type React from "react";
import { useState } from "react";
import { isImeKey } from "../app/keys";
import { formatSynced } from "../app/syncText";
import { Button } from "../components/Button";
import { Segmented } from "../components/Segmented";
import type { SyncState } from "../components/SyncStatus";
import type { SyncBackend, SyncRecoverMode, SyncSettingsDto, SyncStatusDto, TailnetStatus } from "../types/model";
import { Desc, Row, Section } from "./SettingsPanes";
import { NasFields, hintStyle } from "./SyncFields";

/** 実行中の操作 (一度に一つ)。 */
export type SyncBusy = "backend" | "login" | "retry" | "reset" | "logout" | "check" | "disconnect" | "syncNow" | "recover";

/** Tailscale が起動中のままこの秒数を超えたら、「再試行」「状態を消してログインし直す」を出す (仕様 §4.1)。 */
export const TAILNET_SLOW_SECS = 30;

/** Google Drive の画面は Task 9。それまでは、ビルドに OAuth クライアントがあっても「準備中」にする。 */
const GOOGLE_UI_READY = false;

const dangerStyle: React.CSSProperties = { ...hintStyle, color: "var(--color-danger)" };

export type TailnetActions = {
  onLogin?: () => void;
  /** `loginUrl` を開く (https:// で始まるものだけ。呼び出し側が確かめる)。 */
  onOpenLoginUrl?: (url: string) => void;
  onRetry?: () => void;
  onReset?: () => void;
  onLogout?: () => void;
};

export type SyncPaneProps = TailnetActions & {
  /** null = 読み込み中。 */
  settings: SyncSettingsDto | null;
  status: SyncStatusDto | null;
  tailnet: TailnetStatus | null;
  /** `starting` に入ってからの秒数 (呼び出し側が進める)。 */
  tailnetSecs?: number;
  busy?: SyncBusy | null;
  /** 操作の失敗 (Tailscale の操作、今すぐ同期、切断、同期先の切り替え)。日本語でそのまま出す。 */
  error?: string | null;
  /** 「確かめる」の失敗。 */
  checkError?: string | null;
  /** 「戻す」の失敗。 */
  recoverError?: string | null;
  onChangeBackend?: (b: SyncBackend) => void;
  /** 成功したら true。パスワードは呼び出し側に残さず、成功したら入力欄も消す。 */
  onCheck?: (url: string, user: string, password: string) => Promise<boolean>;
  onDisconnect?: () => void;
  onSyncNow?: () => void;
  onRecover?: (mode: SyncRecoverMode) => void;
  onOpenGuide?: () => void;
};

/** NAS が設定ずみ: 同期先が NAS で、アドレス・ユーザー・パスワードが揃っている。 */
export function isNasConnected(s: SyncSettingsDto | null): boolean {
  return !!s && s.backend === "nas" && !!s.nasUrl && !!s.nasUser && s.nasPasswordSet;
}

/** 同期先の名前 (確認ダイアログや「戻す」の文言用)。 */
export function targetName(b: SyncBackend | undefined): string {
  return b === "gdrive" ? "Google Drive" : "NAS";
}

const PASSWORD_NOT_SAVED = "パスワードを保存できません (再起動するまで有効)";

function Dot({ color }: { color: string }) {
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: color, flex: "0 0 auto", marginTop: 5 }} />;
}

const bodyText: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", overflowWrap: "anywhere" };

const linkButton: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: 0,
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  lineHeight: "17px",
  color: "var(--color-accent)",
  cursor: "pointer",
};

/** Tailscale の状態の一行 + その状態で押せる操作 (D-09e)。 */
export function TailnetRow({
  tailnet: t,
  secs = 0,
  busy,
  onLogin,
  onOpenLoginUrl,
  onRetry,
  onReset,
  onLogout,
}: TailnetActions & { tailnet: TailnetStatus | null; secs?: number; busy?: SyncBusy | null }) {
  const stuck = t?.state === "failed" || (t?.state === "starting" && secs >= TAILNET_SLOW_SECS);
  const working = !!busy;
  let color = "var(--color-text-muted)";
  let text: string;
  let actions: React.ReactNode = null;
  switch (t?.state) {
    case undefined:
      text = "確認中…";
      break;
    case "stopped":
      text = "停止中";
      actions = (
        <Button onClick={onLogin} disabled={working}>
          Tailscale にログイン
        </Button>
      );
      break;
    case "needs_login":
      if (t.loginUrl) {
        const url = t.loginUrl;
        text = "ブラウザで Tailscale にログインしてください。開かないときは「ブラウザで開く」を押してください";
        actions = (
          <Button onClick={() => onOpenLoginUrl?.(url)} disabled={working}>
            ブラウザで開く
          </Button>
        );
      } else {
        text = "Tailscale のログインが必要です";
        actions = (
          <Button onClick={onLogin} disabled={working}>
            Tailscale にログイン
          </Button>
        );
      }
      break;
    case "needs_approval":
      text = t.name
        ? `承認待ちです。Tailscale の管理画面で、この PC (${t.name}) を承認してください`
        : "承認待ちです。Tailscale の管理画面で、この PC を承認してください";
      break;
    case "starting":
      text = `起動中… ${secs} 秒`;
      break;
    case "running":
      color = "var(--color-success)";
      text = ["接続済み", t.name, t.ip].filter(Boolean).join(" · ");
      actions = (
        <Button variant="secondary" onClick={onLogout} disabled={working}>
          Tailscale からログアウト
        </Button>
      );
      break;
    case "failed":
      color = "var(--color-danger)";
      text = t.error ? `失敗: ${t.error}` : "Tailscale を起動できませんでした";
      break;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Dot color={color} />
        <span style={bodyText}>{text}</span>
      </div>
      {(actions || stuck) && (
        <Row>
          {actions}
          {stuck && (
            <>
              <Button onClick={onRetry} disabled={working}>
                再試行
              </Button>
              <Button variant="secondary" onClick={onReset} disabled={working}>
                状態を消してログインし直す
              </Button>
            </>
          )}
        </Row>
      )}
    </div>
  );
}

export type NasSetupProps = TailnetActions & {
  settings: SyncSettingsDto;
  tailnet: TailnetStatus | null;
  tailnetSecs?: number;
  busy?: SyncBusy | null;
  error?: string | null;
  checkError?: string | null;
  onCheck?: (url: string, user: string, password: string) => Promise<boolean>;
  onOpenGuide?: () => void;
  /** 「確かめる」ボタンの文言 (初回起動は「確かめて次へ」)。 */
  submitLabel?: string;
  /** 「確かめる」が通ったとき (設定ペインは設定の再読み込みで接続済みの画面に変わる)。 */
  onConnected?: () => void;
};

/** NAS の接続前 (D-09e): Tailscale の状態、URL・ユーザー・パスワード、「確かめる」、手順へのリンク。設定ペインと初回起動で共通。 */
export function NasSetup({
  settings,
  tailnet,
  tailnetSecs,
  busy,
  error,
  checkError,
  onCheck,
  onOpenGuide,
  submitLabel = "確かめる",
  onConnected,
  ...tailnetActions
}: NasSetupProps) {
  const [url, setUrl] = useState(settings.nasUrl ?? "");
  const [user, setUser] = useState(settings.nasUser ?? "");
  const [password, setPassword] = useState("");
  const checking = busy === "check";
  const ready = !!url.trim() && !!user.trim() && !!password && !!onCheck && !busy;

  const submit = async () => {
    if (!ready || !onCheck) return;
    const ok = await onCheck(url.trim(), user.trim(), password);
    if (ok) {
      setPassword(""); // 通ったら入力欄を空にする (保存先はキーチェーン)
      onConnected?.();
    }
  };

  return (
    <>
      <Section label="Tailscale">
        <TailnetRow tailnet={tailnet} secs={tailnetSecs} busy={busy} {...tailnetActions} />
        {error && (
          <div role="alert" style={dangerStyle}>
            {error}
          </div>
        )}
      </Section>
      <Section label="接続">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isImeKey(e)) e.preventDefault(); // 変換確定の Enter で送らない (keys.ts)
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
        >
          <NasFields
            values={{ url, user, password }}
            onChange={(v) => {
              setUrl(v.url);
              setUser(v.user);
              setPassword(v.password);
            }}
            placeholders
            passwordNote={settings.passwordPersistent ? undefined : PASSWORD_NOT_SAVED}
          />
          <Row>
            <Button type="submit" disabled={!ready}>
              {checking ? "確かめています…" : submitLabel}
            </Button>
          </Row>
        </form>
        {checkError && (
          <div role="alert" style={dangerStyle}>
            {checkError}
          </div>
        )}
        <Desc>
          アドレスは <code>http://</code> で始め、NAS の名前を使います。パスワードは OS のキーチェーンに保存されます。
        </Desc>
        <button type="button" style={linkButton} onClick={onOpenGuide}>
          NAS の準備手順
        </button>
      </Section>
    </>
  );
}

const stateText: Record<SyncState, string> = {
  synced: "同期済み",
  syncing: "同期中…",
  offline: "オフライン",
  error: "エラー",
  off: "同期は開始していません",
};

/** NAS の接続後 (D-09f): 接続先、状態、最終同期、「今すぐ同期」、「切断」。 */
function NasConnected({
  settings,
  status,
  tailnet,
  tailnetSecs,
  busy,
  error,
  onSyncNow,
  onDisconnect,
  ...tailnetActions
}: TailnetActions & Pick<SyncPaneProps, "status" | "tailnet" | "tailnetSecs" | "busy" | "error" | "onSyncNow" | "onDisconnect"> & { settings: SyncSettingsDto }) {
  const synced = formatSynced(status?.lastSynced, { long: true });
  const state = status?.state ?? "off";
  const ok = state === "synced" || state === "syncing";
  return (
    <>
      <Section label="接続状態">
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
          <Dot color={ok ? "var(--color-success)" : "var(--color-text-muted)"} />
          <span style={bodyText}>{`接続中 · ${settings.nasUrl} · ${settings.nasUser}`}</span>
          <Button variant="secondary" onClick={onDisconnect} disabled={!!busy}>
            切断
          </Button>
        </div>
        {!settings.passwordPersistent && <div style={dangerStyle}>{PASSWORD_NOT_SAVED}</div>}
        {tailnet?.state !== "running" && <TailnetRow tailnet={tailnet} secs={tailnetSecs} busy={busy} {...tailnetActions} />}
      </Section>
      <Section label="同期">
        <Desc>{`状態: ${stateText[state]}`}</Desc>
        {status?.message && (
          <div role={state === "error" ? "alert" : undefined} style={state === "error" ? dangerStyle : hintStyle}>
            {status.message}
          </div>
        )}
        <Desc>{synced ? `最終同期: ${synced}` : "最終同期: まだありません"}</Desc>
        {!!status?.pending && <Desc>{`次の同期に回したファイル: ${status.pending} 件`}</Desc>}
        {error && (
          <div role="alert" style={dangerStyle}>
            {error}
          </div>
        )}
        <Row>
          <Button onClick={onSyncNow} disabled={!!busy || state === "syncing"}>
            {busy === "syncNow" ? "同期しています…" : "今すぐ同期"}
          </Button>
        </Row>
      </Section>
    </>
  );
}

/** 片方が空に見えて同期が止まっているとき: どちらの内容で戻すかを選ばせる。確認ダイアログと実行は呼び出し側。 */
export function SuspectPanel({
  side,
  target,
  busy,
  error,
  onRecover,
}: {
  side: "local" | "remote";
  target: string;
  busy?: boolean;
  error?: string | null;
  onRecover?: (mode: SyncRecoverMode) => void;
}) {
  const likely: SyncRecoverMode = side === "local" ? "mirrorRemote" : "mirrorLocal";
  return (
    <Section label="同期が止まっています">
      <Desc>
        {side === "local"
          ? `この PC のデータフォルダが空に見えます。${target} の内容で戻すか、この PC の内容を正とするか選んでください。`
          : `${target} が空に見えます。この PC の内容で戻すか、${target} の内容を正とするか選んでください。`}
        戻す前のファイルは archive/ フォルダに残ります。
      </Desc>
      <Row>
        <Button variant={likely === "mirrorRemote" ? "primary" : "secondary"} onClick={() => onRecover?.("mirrorRemote")} disabled={busy}>
          {`${target} の内容でこの PC を戻す`}
        </Button>
        <Button variant={likely === "mirrorLocal" ? "primary" : "secondary"} onClick={() => onRecover?.("mirrorLocal")} disabled={busy}>
          {`この PC の内容で ${target} を戻す`}
        </Button>
      </Row>
      {error && (
        <div role="alert" style={dangerStyle}>
          {error}
        </div>
      )}
    </Section>
  );
}

/**
 * 設定の「同期」ペインの中身 (同期先のセグメント + 同期先ごとの本文)。設定ダイアログと Storybook で使う。
 * Google Drive は Task 9 まで「このビルドでは準備中」で選べない。
 */
export function SyncPane(props: SyncPaneProps) {
  const { settings, status, tailnet, tailnetSecs, busy, error, checkError, recoverError, onChangeBackend, onCheck, onDisconnect, onSyncNow, onRecover, onOpenGuide, ...tailnetActions } = props;
  const googleReady = GOOGLE_UI_READY && !!settings?.googleAvailable;
  const options = [
    { value: "gdrive" as const, label: "Google Drive", disabled: !googleReady },
    { value: "nas" as const, label: "Synology NAS (WebDAV)" },
    { value: "none" as const, label: "同期しない" },
  ];

  let body: React.ReactNode = null;
  if (!settings) {
    body = <Desc>読み込み中…</Desc>;
  } else if (settings.backend === "gdrive") {
    body = (
      <Section label="Google Drive">
        <Desc>Google Drive はこのビルドでは準備中です。</Desc>
      </Section>
    );
  } else if (settings.backend === "none") {
    body = (
      <Section label="同期">
        <Desc>同期しません。タスクはこの PC のデータフォルダにだけ保存されます。</Desc>
      </Section>
    );
  } else if (isNasConnected(settings)) {
    body = (
      <NasConnected
        settings={settings}
        status={status}
        tailnet={tailnet}
        tailnetSecs={tailnetSecs}
        busy={busy}
        error={error}
        onSyncNow={onSyncNow}
        onDisconnect={onDisconnect}
        {...tailnetActions}
      />
    );
  } else {
    body = (
      <NasSetup
        // 切断や接続で保存済みの値が変わったら、入力欄も作り直す
        key={`${settings.nasUrl ?? ""}|${settings.nasUser ?? ""}`}
        settings={settings}
        tailnet={tailnet}
        tailnetSecs={tailnetSecs}
        busy={busy}
        error={error}
        checkError={checkError}
        onCheck={onCheck}
        onOpenGuide={onOpenGuide}
        {...tailnetActions}
      />
    );
  }

  return (
    <>
      <Section label="同期先">
        <Segmented
          options={options}
          value={settings?.backend ?? "none"}
          onChange={onChangeBackend}
          ariaLabel="同期先"
          disabled={!settings || busy === "backend"}
        />
        {!googleReady && <Desc>Google Drive はこのビルドでは準備中です。</Desc>}
      </Section>
      {settings && status?.suspect && settings.backend !== "none" && (
        <SuspectPanel side={status.suspect} target={targetName(settings.backend)} busy={!!busy} error={recoverError} onRecover={onRecover} />
      )}
      {body}
      {error && settings?.backend !== "nas" && (
        <div role="alert" style={dangerStyle}>
          {error}
        </div>
      )}
    </>
  );
}
