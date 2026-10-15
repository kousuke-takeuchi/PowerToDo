import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import { confirmAction } from "../api/dialogs";
import type { NotificationPermission, SettingsDto } from "../types/model";
import type { AccountPaneProps, DataPaneProps, DateTimePaneProps, NotificationsPaneProps } from "../views/SettingsPanes";

/** `trayError` は呼び出し側 (AppStateDto) が足す。 */
export type SettingsPanes = {
  data: DataPaneProps;
  account: AccountPaneProps;
  notifications: Omit<NotificationsPaneProps, "trayError">;
  datetime: DateTimePaneProps;
};

type Options = {
  /** データフォルダを変更し終えたとき (プロジェクト一覧などを読み直すのは呼び出し側)。 */
  onDataDirChanged: () => void;
  /** 表示名を保存したとき。 */
  onDisplayNameChanged: (name: string) => void;
};

/**
 * 設定ダイアログの「データ」「アカウント」「通知」「日付と時刻」ペインに渡す値とハンドラ。`open` になるたびに `settings` を読み直し、
 * エラー / busy を消す。閉じた後に返ってきた結果では state を更新しない (変更が済んだことの通知は呼び出し側に届ける)。
 * データフォルダの変更は pick_folder -> 確認 -> set_data_dir の順で、既存のファイルは移動しない。
 */
export function useSettingsPanes(open: boolean, { onDataDirChanged, onDisplayNameChanged }: Options): SettingsPanes {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [dateBusy, setDateBusy] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  /** 開くたび / 閉じるたびに進める。古い世代の結果は捨てる。 */
  const gen = useRef(0);
  /** 最新の settings と、保存を一つずつ流す列 (続けて変えても前の保存の結果に上書きされない)。 */
  const latest = useRef<SettingsDto | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!open) return;
    const g = ++gen.current;
    setSettings(null);
    latest.current = null;
    setPermission(null);
    setNotifBusy(false);
    setNotifError(null);
    setDateBusy(false);
    setDateError(null);
    setDataBusy(false);
    setDataError(null);
    setAccountBusy(false);
    setAccountError(null);
    api
      .settings()
      .then((s) => {
        if (g !== gen.current) return;
        latest.current = s;
        setSettings(s);
      })
      .catch((e) => {
        if (g !== gen.current) return;
        setDataError(errorMessage(e));
        setAccountError(errorMessage(e));
        setNotifError(errorMessage(e));
        setDateError(errorMessage(e));
      });
    api
      .notificationPermission()
      .then((v) => g === gen.current && setPermission(v))
      .catch(() => undefined); // 取れなければ「許可済み」のまま (許可を求める欄を出さない)
    return () => {
      gen.current++;
    };
  }, [open]);

  const onReveal = useCallback(() => {
    const g = gen.current;
    void api.revealDataDir().catch((e) => g === gen.current && setDataError(errorMessage(e)));
  }, []);

  const onChangeFolder = async () => {
    if (dataBusy) return;
    const g = gen.current;
    const alive = () => g === gen.current;
    setDataBusy(true);
    setDataError(null);
    try {
      const dir = await api.pickFolder();
      if (!dir || dir === settings?.dataDir) return; // キャンセル / 同じ場所
      const ok = await confirmAction(`データフォルダを変更します。既存のファイルは移動しません。\n\n新しい場所: ${dir}`, {
        title: "データフォルダの変更",
        okLabel: "変更する",
      });
      if (!ok) return;
      await api.setDataDir(dir);
      const s = await api.settings().catch(() => null);
      if (alive()) setSettings((cur) => s ?? (cur ? { ...cur, dataDir: dir } : cur));
      onDataDirChanged();
    } catch (e) {
      if (alive()) setDataError(errorMessage(e));
    } finally {
      if (alive()) setDataBusy(false);
    }
  };

  /** 変更した項目だけを、その時点の最新の settings に重ねて保存する。結果は世代が同じときだけ反映する。 */
  const save = (
    patch: Partial<SettingsDto>,
    setBusy: (v: boolean) => void,
    setError: (v: string | null) => void,
  ): Promise<SettingsDto | null> => {
    const g = gen.current;
    const alive = () => g === gen.current;
    setBusy(true);
    setError(null);
    const run = async (): Promise<SettingsDto | null> => {
      const cur = latest.current;
      if (!alive() || !cur) return null;
      try {
        const next = await api.updateSettings({ ...cur, ...patch });
        if (alive()) {
          latest.current = next;
          setSettings(next);
        }
        return next;
      } catch (e) {
        if (alive()) setError(errorMessage(e));
        return null;
      }
    };
    const result = queue.current.then(run);
    queue.current = result.then(() => undefined);
    return result.finally(() => {
      if (alive()) setBusy(false);
    });
  };

  const onSaveDisplayName = async (name: string): Promise<boolean> => {
    if (!settings || accountBusy) return false;
    const next = await save({ displayName: name }, setAccountBusy, setAccountError);
    if (next) onDisplayNameChanged(next.displayName);
    return !!next;
  };

  const onRequestPermission = () => {
    const g = gen.current;
    setNotifError(null);
    void api
      .requestNotificationPermission()
      .then((v) => g === gen.current && setPermission(v))
      .catch((e) => g === gen.current && setNotifError(errorMessage(e)));
  };

  const saveNotif = (patch: Partial<SettingsDto>) => void save(patch, setNotifBusy, setNotifError);
  const saveDate = (patch: Partial<SettingsDto>) => void save(patch, setDateBusy, setDateError);

  return {
    data: {
      dataDir: settings?.dataDir ?? "",
      onReveal,
      onChangeFolder: () => void onChangeFolder(),
      busy: dataBusy,
      error: dataError,
    },
    account: {
      displayName: settings?.displayName ?? "",
      // 読み込み前 (失敗を含む) は保存させない: 送る SettingsDto が無い
      onSaveDisplayName: settings ? onSaveDisplayName : undefined,
      busy: accountBusy,
      error: accountError,
    },
    notifications: {
      enabled: settings?.notifications ?? true,
      onToggle: (v) => saveNotif({ notifications: v }),
      permission: permission ?? "granted",
      onRequestPermission,
      keepInTray: settings?.keepInTray ?? true,
      onToggleKeepInTray: (v) => saveNotif({ keepInTray: v }),
      busy: notifBusy,
      error: notifError,
    },
    datetime: {
      defaultReminder: settings?.defaultReminder ?? null,
      onChangeDefaultReminder: (v) => saveDate({ defaultReminder: v }),
      notifyTime: settings?.notifyTime ?? "09:00",
      onChangeNotifyTime: (v) => saveDate({ notifyTime: v }),
      weekStart: settings?.weekStart ?? "mon",
      onChangeWeekStart: (v) => saveDate({ weekStart: v }),
      busy: dateBusy,
      error: dateError,
    },
  };
}
