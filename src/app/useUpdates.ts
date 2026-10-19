import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorMessage } from "../api/client";
import { onUpdateProgress } from "../api/events";
import { RELEASE_URL } from "./releaseUrl";
import type { UpdateProgress, UpdateStatusDto } from "../types/model";

/** 起動から最初の自動確認までの待ち。 */
export const AUTO_CHECK_DELAY_MS = 5000;

/** 見つかった新しい版。 */
export type UpdateOffer = { version: string; notes?: string; date?: string };

/** 自動で見つけた更新を、この間隔で出せるか見直す (入力中でなくなってから少し待つ)。 */
const SHOW_RETRY_MS = 500;
/** `update-progress` の購読が済むのを待つ上限 (購読に失敗しても更新は止めない)。 */
const LISTEN_WAIT_MS = 2000;

/** 文字を打てる欄にフォーカスがある。 */
function typingNow(): boolean {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable)) return true;
  return a instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(a.type);
}

export type UpdatesApi = {
  /** 現在の版と、この入れ方で更新できるか。読み込むまで null。 */
  status: UpdateStatusDto | null;
  /** 見つかった新しい版。これがあるあいだ更新ダイアログを出す。 */
  offer: UpdateOffer | null;
  /** 「今すぐ更新」を押してからのあいだ。更新が済むと (再起動で) アプリごと終わるので、成功しても戻さない。 */
  installing: boolean;
  /** `update-progress` の最新。まだ届いていなければ null。 */
  progress: UpdateProgress | null;
  /** `check` の実行中。 */
  checking: boolean;
  /** 手動の確認で「最新です」だったとき true。次の確認を始めると消える。 */
  upToDate: boolean;
  /** 設定ペインに出す文: 手動の確認の失敗、スイッチの保存の失敗、release ページを開けなかった。 */
  error: string | null;
  /** 更新ダイアログに出す文: 更新の失敗。`offer` は残るので、もう一度 `install` できる。 */
  installError: string | null;
  /** `manual`: 設定の「更新を確認」。失敗を `error` に出し、「あとで」にした版も出し直す。自動 (起動時): 失敗は捨て、「あとで」にした版は出さない。 */
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  /** 「あとで」「閉じる」: この版はこのプロセスの間、自動では出さない (保存しない)。更新中は何もしない。 */
  later: () => void;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  openReleasePage: () => Promise<void>;
};

/**
 * アプリの更新 (リリースの仕様 §4)。起動時に状態を読み、`supported` で自動確認がオンなら 5 秒後に一度だけ確認する。
 * `hold`: true のあいだ (クイック追加 / 検索を開いている)、自動で見つけた更新は出さずに待つ。文字を打てる欄にフォーカスがあるあいだも待ち、
 * 閉じたとき / フォーカスが外れたとき (`focusout`) に、少し置いて出す。手動の確認はすぐ出す。
 * 状態は state だけで持つ (「あとで」の版も保存しない)。アンマウントでタイマーと購読を解除する。
 */
export function useUpdates({ hold = false }: { hold?: boolean } = {}): UpdatesApi {
  const [status, setStatus] = useState<UpdateStatusDto | null>(null);
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  /** 自動で見つけたが、入力のじゃまになるのでまだ出していない版。 */
  const [pending, setPending] = useState<UpdateOffer | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [checking, setChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const alive = useRef(true);
  const statusRef = useRef<UpdateStatusDto | null>(null);
  const offerRef = useRef<UpdateOffer | null>(null);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  /** 「あとで」にした版。 */
  const laterVersion = useRef<string | null>(null);
  const stopProgress = useRef<(() => void) | null>(null);

  const applyOffer = (o: UpdateOffer | null) => {
    offerRef.current = o;
    setOffer(o);
    setPending(null);
  };

  const check = useCallback(async (manual: boolean) => {
    // 二重に始めない。更新中は確認しない (Rust 側も、更新中は見つからなかったことにする)。
    if (checkingRef.current || installingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    if (manual) {
      setError(null);
      setUpToDate(false);
    }
    try {
      const r = await api.updateCheck();
      if (!alive.current) return;
      if (r.available && r.version) {
        const found = { version: r.version, notes: r.notes, date: r.date };
        if (manual) applyOffer(found);
        else if (laterVersion.current !== r.version && !offerRef.current) setPending(found);
      } else if (manual) {
        setUpToDate(true);
      }
    } catch (e) {
      if (alive.current && manual) setError(errorMessage(e));
    } finally {
      checkingRef.current = false;
      if (alive.current) setChecking(false);
    }
  }, []);

  // 起動: 状態を読み、`supported` で自動確認がオンなら 5 秒後に一度だけ確認する (待つあいだにスイッチが切られたら、その時の値で決める)。
  useEffect(() => {
    alive.current = true;
    // この effect だけの印: StrictMode の 1 回目の cleanup 後に、その回の待ちがタイマーを作らないように
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    api
      .updateStatus()
      .then((s) => {
        if (cancelled) return;
        statusRef.current = s;
        setStatus(s);
        if (s.support === "supported" && s.autoCheck) {
          timer = setTimeout(() => {
            const cur = statusRef.current;
            if (cur?.support === "supported" && cur.autoCheck) void check(false);
          }, AUTO_CHECK_DELAY_MS);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
      alive.current = false;
      if (timer !== undefined) clearTimeout(timer);
      stopProgress.current?.();
      stopProgress.current = null;
    };
  }, [check]);

  // 待たせていた自動の更新: 閉じたら / 入力が済んだら、少し置いて出す。
  useEffect(() => {
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryShow = () => {
      if (hold || typingNow() || offerRef.current) return;
      applyOffer(pending);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tryShow, SHOW_RETRY_MS);
    };
    schedule();
    document.addEventListener("focusout", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusout", schedule);
    };
  }, [pending, hold]);

  const install = useCallback(async () => {
    if (installingRef.current || !offerRef.current) return;
    installingRef.current = true;
    setInstalling(true);
    setInstallError(null);
    setProgress(null);
    stopProgress.current?.();
    // 購読が済んでから始める (先に始めると、最初の `waitingSync` を取りこぼす)。購読に失敗しても止まらないよう上限を置く。
    let ready: () => void = () => undefined;
    const subscribed = new Promise<void>((resolve) => {
      ready = resolve;
    });
    stopProgress.current = onUpdateProgress((p) => {
      if (alive.current) setProgress(p);
    }, ready);
    try {
      let wait: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([subscribed, new Promise<void>((resolve) => (wait = setTimeout(resolve, LISTEN_WAIT_MS)))]);
      clearTimeout(wait);
      if (!alive.current) return;
      await api.updateInstall();
      // 成功: アプリが再起動する (Windows はインストーラーが終わらせる)。ボタンを戻さず「入れ替えています…」のままにする。
    } catch (e) {
      stopProgress.current?.();
      stopProgress.current = null;
      installingRef.current = false;
      if (alive.current) {
        setInstalling(false);
        setProgress(null);
        setInstallError(errorMessage(e));
      }
    }
  }, []);

  const later = useCallback(() => {
    if (installingRef.current) return;
    if (offerRef.current) laterVersion.current = offerRef.current.version;
    setInstallError(null);
    applyOffer(null);
  }, []);

  const setAutoCheck = useCallback(async (enabled: boolean) => {
    const prev = statusRef.current;
    if (!prev) return;
    const next = { ...prev, autoCheck: enabled };
    statusRef.current = next;
    setStatus(next);
    setError(null);
    try {
      await api.setUpdateAutoCheck(enabled);
    } catch (e) {
      if (!alive.current) return;
      // 保存できなかった: スイッチを元に戻す。
      const back = { ...(statusRef.current ?? prev), autoCheck: prev.autoCheck };
      statusRef.current = back;
      setStatus(back);
      setError(errorMessage(e));
    }
  }, []);

  const openReleasePage = useCallback(async () => {
    try {
      await openUrl(RELEASE_URL);
    } catch (e) {
      if (alive.current) setError(`ブラウザを開けませんでした: ${errorMessage(e)}`);
    }
  }, []);

  return { status, offer, installing, progress, checking, upToDate, error, installError, check, install, later, setAutoCheck, openReleasePage };
}
