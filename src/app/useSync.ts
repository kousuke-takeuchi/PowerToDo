import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorMessage } from "../api/client";
import { confirmAction } from "../api/dialogs";
import { onSyncConflict, onSyncStatus, onTailnetStatus } from "../api/events";
import type { SyncBackend, SyncConflict, SyncRecoverMode, SyncSettingsDto, SyncStatusDto, TailnetStatus } from "../types/model";
import type { SyncBusy, SyncPaneProps } from "../views/SyncPane";
import { isNasConnected, recoverQuestion, recoverResult, targetName } from "./syncText";

type Options = {
  /** 「同期」ペイン (設定ダイアログ / 初回起動) を見せている間 true。設定と Tailscale の状態は、このときだけ読む。 */
  active: boolean;
  /** 画面に出す結果 (戻す操作の結果、サイドバーからの「今すぐ同期」の失敗)。 */
  onNotice?: (text: string, tone: "info" | "error") => void;
};

const BACKEND_NAMES: Record<SyncBackend, string> = { gdrive: "Google Drive", nas: "Synology NAS", none: "同期しない" };

/**
 * 同期の状態と操作 (Phase 4)。`sync-status` / `sync-conflict` は常に聞き、設定 (`sync_settings`) と Tailscale の状態
 * (`tailnet_status` / `tailnet-status`) は `active` の間と、片方が空に見えて同期が止まっている間だけ読む
 * (設定を読むとキーチェーンに触れるので、使わない起動では触れない)。
 * パスワードはここでも持たない: 「確かめる」の引数として通すだけで、ログにも保存にも出さない。
 */
export function useSync({ active, onNotice }: Options) {
  const [status, setStatus] = useState<SyncStatusDto | null>(null);
  const [settings, setSettings] = useState<SyncSettingsDto | null>(null);
  const [tailnet, setTailnet] = useState<TailnetStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [busy, setBusy] = useState<SyncBusy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  /** `starting` の秒数を進めるための現在時刻と、その状態を受け取った時刻。 */
  const [now, setNow] = useState(() => Date.now());
  const tailnetAt = useRef(Date.now());
  const tailnetRef = useRef<TailnetStatus | null>(null);
  /** 「Tailscale にログイン」を押した後、最初に届く https のログイン URL を一度だけ開く。 */
  const loginPending = useRef(false);
  const busyRef = useRef<SyncBusy | null>(null);
  const alive = useRef(true);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const wanted = active || !!status?.suspect;

  // ---- sync-status / sync-conflict: 常に ----
  useEffect(() => {
    const read = () =>
      void api
        .syncStatus()
        .then((s) => alive.current && setStatus(s))
        .catch(() => undefined);
    const off = onSyncStatus((s) => setStatus(s), read);
    return off;
  }, []);
  useEffect(
    () =>
      onSyncConflict((c) =>
        // 同じ競合コピーの通知は一つにまとめる
        setConflicts((cur) => (cur.some((x) => x.conflictFile === c.conflictFile) ? cur : [...cur, c])),
      ),
    [],
  );

  // ---- 設定と Tailscale: 必要なときだけ ----
  const reloadSettings = useCallback(async () => {
    try {
      const s = await api.syncSettings();
      if (alive.current) setSettings(s);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  }, []);

  const openLoginUrl = useCallback(async (url: string) => {
    // ブラウザで開くのは https:// だけ (他の形は開かずに知らせる)
    if (!url.startsWith("https://")) {
      setError("Tailscale のログイン用アドレスが https:// で始まらないため、開きませんでした");
      return;
    }
    try {
      await openUrl(url);
    } catch (e) {
      if (alive.current) setError(`ブラウザを開けませんでした: ${errorMessage(e)}`);
    }
  }, []);

  const applyTailnet = useCallback(
    (s: TailnetStatus) => {
      tailnetRef.current = s;
      tailnetAt.current = Date.now();
      setNow(Date.now());
      setTailnet(s);
      if (s.state === "needs_login" && s.loginUrl && loginPending.current) {
        loginPending.current = false;
        void openLoginUrl(s.loginUrl);
      } else if (s.state !== "needs_login" && s.state !== "starting") {
        loginPending.current = false;
      }
    },
    [openLoginUrl],
  );

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void reloadSettings();
    void api
      .tailnetStatus()
      .then((s) => live && alive.current && applyTailnet(s))
      .catch(() => undefined);
    const off = onTailnetStatus(
      (s) => applyTailnet(s),
      // 購読が始まる前に届いた分を取りこぼさない
      () =>
        void api
          .tailnetStatus()
          .then((s) => live && alive.current && applyTailnet(s))
          .catch(() => undefined),
    );
    return () => {
      live = false;
      off();
    };
  }, [wanted, reloadSettings, applyTailnet]);

  // ペインを閉じたら、前回の失敗と Tailscale の古い状態は消す (開き直したら読み直す)
  useEffect(() => {
    if (active) return;
    setError(null);
    setCheckError(null);
  }, [active]);
  useEffect(() => {
    if (wanted) return;
    tailnetRef.current = null;
    loginPending.current = false;
    setTailnet(null);
  }, [wanted]);
  // 片方が空に見える状態が終わったら、戻せなかった理由も消す
  const suspected = !!status?.suspect;
  useEffect(() => {
    if (!suspected) setRecoverError(null);
  }, [suspected]);

  // `starting` を見せている間だけ秒数を進める (ペインが閉じていれば止める: 1 秒ごとの再描画を避ける)
  useEffect(() => {
    if (!wanted || tailnet?.state !== "starting") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [wanted, tailnet?.state]);
  const tailnetSecs = tailnet?.state === "starting" ? (tailnet.startedSecs ?? 0) + Math.max(0, Math.floor((now - tailnetAt.current) / 1000)) : 0;

  // ---- 操作 ----
  /**
   * 一度に一つ。他の操作が走っている間は何もしない (押すボタンは busy で無効になる)。成功なら true。
   * `confirm` は確認ダイアログ: 操作の枠を取ってから出すので、続けて押しても二つ開かない。断られたら false。
   */
  const run = useCallback(async (
    kind: SyncBusy,
    fn: () => Promise<void>,
    fail: (message: string) => void = setError,
    confirm?: () => Promise<boolean>,
  ): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = kind;
    setBusy(kind);
    setError(null);
    try {
      if (confirm && !(await confirm())) return false;
      await fn();
      return true;
    } catch (e) {
      if (alive.current) fail(errorMessage(e));
      return false;
    } finally {
      busyRef.current = null;
      if (alive.current) setBusy(null);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const s = await api.syncStatus();
    if (alive.current) setStatus(s);
    return s;
  }, []);

  const refreshTailnet = useCallback(async () => {
    const t = await api.tailnetStatus();
    if (alive.current) applyTailnet(t);
  }, [applyTailnet]);

  /** 同期先を変える。確認を出し (`confirm: false` は初回起動)、成功したら true。 */
  const setBackend = useCallback(
    async (backend: SyncBackend, { confirm = true }: { confirm?: boolean } = {}): Promise<boolean> => {
      const cur = settingsRef.current;
      if (!cur) return false;
      if (backend === cur.backend) return true;
      if (backend === "gdrive" && !cur.googleAvailable) return false;
      const message =
        backend === "none"
          ? "同期をやめます。この PC のファイルはそのまま残ります。あとで同期先を選ぶと、全ファイルを送り直します。"
          : `同期先を「${BACKEND_NAMES[backend]}」に変えます。次の同期で全ファイルを送り直します。`;
      return run(
        "backend",
        async () => {
          const next = await api.setSyncBackend(backend);
          if (alive.current) setSettings(next);
          await refreshStatus();
          await refreshTailnet().catch(() => undefined);
        },
        setError,
        confirm ? () => confirmAction(message, { title: "同期先の変更", okLabel: "変更する" }).catch(() => false) : undefined,
      );
    },
    [run, refreshStatus, refreshTailnet],
  );

  const login = useCallback(
    () =>
      run("login", async () => {
        loginPending.current = true;
        try {
          await api.tailnetLogin();
        } catch (e) {
          loginPending.current = false;
          throw e;
        }
        // URL が先に届いていたなら、ここで開く (届く前なら applyTailnet が開く)
        const t = tailnetRef.current;
        if (loginPending.current && t?.state === "needs_login" && t.loginUrl) {
          loginPending.current = false;
          await openLoginUrl(t.loginUrl);
        }
      }),
    [run, openLoginUrl],
  );

  const retry = useCallback(() => run("retry", () => api.tailnetRetry().then(() => undefined)), [run]);

  const reset = useCallback(
    () =>
      run(
        "reset",
        async () => {
          loginPending.current = true; // 作り直した後に届くログイン URL は、押した結果として開く
          try {
            await api.tailnetReset();
          } catch (e) {
            loginPending.current = false;
            throw e;
          }
        },
        setError,
        () =>
          confirmAction("この PC の Tailscale のログイン情報を消して、最初からログインし直します。", {
            title: "Tailscale の状態を消す",
            okLabel: "消してログインし直す",
          }).catch(() => false),
      ),
    [run],
  );

  const logout = useCallback(
    () =>
      run(
        "logout",
        () => api.tailnetLogout().then(() => undefined),
        setError,
        () =>
          confirmAction("この PC を Tailscale からログアウトします。NAS と同期するには、もう一度ログインが必要です。", {
            title: "Tailscale からログアウト",
            okLabel: "ログアウト",
          }).catch(() => false),
      ),
    [run],
  );

  /** 「確かめる」。通ったら設定を読み直す (接続済みの画面になる)。 */
  const check = useCallback(
    (url: string, user: string, password: string): Promise<boolean> =>
      run(
        "check",
        async () => {
          setCheckError(null);
          await api.nasCheck(url, user, password);
          await reloadSettings();
          await refreshStatus().catch(() => undefined);
        },
        setCheckError,
      ),
    [run, reloadSettings, refreshStatus],
  );

  const disconnect = useCallback(
    () =>
      run("disconnect", async () => {
        await api.nasDisconnect();
        await reloadSettings();
        await refreshStatus().catch(() => undefined);
      }),
    [run, reloadSettings, refreshStatus],
  );

  /** 「今すぐ同期」。`quiet` (サイドバーから) は失敗を画面の通知に出し、ペインのエラー欄は使わない。 */
  const syncNow = useCallback(
    (quiet = false) =>
      run(
        "syncNow",
        async () => {
          const s = await api.syncNow();
          if (alive.current) setStatus(s);
        },
        quiet ? (m) => noticeRef.current?.(m, "error") : setError,
      ),
    [run],
  );

  const recover = useCallback(
    (mode: SyncRecoverMode) => {
      const q = recoverQuestion(mode, targetName(settingsRef.current?.backend));
      /** 失敗は、まだ止まっている間は帯 (とペイン) にだけ出す。止まりが解けていたら、帯が消えるので通知に出す。 */
      const failed = (text: string) => {
        setRecoverError(text);
        void refreshStatus()
          .then((s) => {
            if (s.suspect) return;
            setRecoverError(null);
            noticeRef.current?.(text, "error");
          })
          .catch(() => undefined);
      };
      return run(
        "recover",
        async () => {
          setRecoverError(null);
          const r = await api.syncRecover(mode);
          const msg = recoverResult(r);
          const s = await refreshStatus().catch(() => null);
          if (msg.tone === "error" && s?.suspect) setRecoverError(msg.text);
          else noticeRef.current?.(msg.text, msg.tone);
        },
        // `Invalid` の日本語の理由はそのまま出す
        failed,
        () => confirmAction(q.message, { title: "同期先との食い違いを直す", okLabel: q.okLabel }).catch(() => false),
      );
    },
    [run, refreshStatus],
  );

  const dismissConflict = useCallback((conflictFile: string) => setConflicts((cur) => cur.filter((c) => c.conflictFile !== conflictFile)), []);

  const nasConnected = isNasConnected(settings);

  /** 「同期」ペインにそのまま渡す。 */
  const pane: SyncPaneProps = {
    settings,
    status,
    tailnet,
    tailnetSecs,
    busy,
    error,
    checkError,
    recoverError,
    onChangeBackend: (b) => void setBackend(b),
    onLogin: () => void login(),
    onOpenLoginUrl: (url) => void openLoginUrl(url),
    onRetry: () => void retry(),
    onReset: () => void reset(),
    onLogout: () => void logout(),
    onCheck: check,
    onDisconnect: () => void disconnect(),
    onSyncNow: () => void syncNow(),
    onRecover: (m) => void recover(m),
  };

  return {
    status,
    settings,
    tailnet,
    tailnetSecs,
    conflicts,
    dismissConflict,
    busy,
    error,
    recoverError,
    nasConnected,
    pane,
    setBackend,
    check,
    reloadSettings,
    syncNow,
    recover,
  };
}

export type SyncModel = ReturnType<typeof useSync>;
