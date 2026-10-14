import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import { confirmAction } from "../api/dialogs";
import type { SettingsDto } from "../types/model";
import type { AccountPaneProps, DataPaneProps } from "../views/SettingsPanes";

type Options = {
  /** データフォルダを変更し終えたとき (プロジェクト一覧などを読み直すのは呼び出し側)。 */
  onDataDirChanged: () => void;
  /** 表示名を保存したとき。 */
  onDisplayNameChanged: (name: string) => void;
};

/**
 * 設定ダイアログの「データ」「アカウント」ペインに渡す値とハンドラ。`open` になるたびに `settings` を読み直し、
 * エラー / busy を消す。閉じた後に返ってきた結果では state を更新しない (変更が済んだことの通知は呼び出し側に届ける)。
 * データフォルダの変更は pick_folder -> 確認 -> set_data_dir の順で、既存のファイルは移動しない。
 */
export function useSettingsPanes(open: boolean, { onDataDirChanged, onDisplayNameChanged }: Options): { data: DataPaneProps; account: AccountPaneProps } {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  /** 開くたび / 閉じるたびに進める。古い世代の結果は捨てる。 */
  const gen = useRef(0);

  useEffect(() => {
    if (!open) return;
    const g = ++gen.current;
    setSettings(null);
    setDataBusy(false);
    setDataError(null);
    setAccountBusy(false);
    setAccountError(null);
    api
      .settings()
      .then((s) => g === gen.current && setSettings(s))
      .catch((e) => {
        if (g !== gen.current) return;
        setDataError(errorMessage(e));
        setAccountError(errorMessage(e));
      });
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

  const onSaveDisplayName = async (name: string): Promise<boolean> => {
    if (!settings || accountBusy) return false;
    const g = gen.current;
    const alive = () => g === gen.current;
    setAccountBusy(true);
    setAccountError(null);
    try {
      const next = await api.updateSettings({ ...settings, displayName: name });
      if (alive()) setSettings(next);
      onDisplayNameChanged(next.displayName);
      return true;
    } catch (e) {
      if (alive()) setAccountError(errorMessage(e));
      return false;
    } finally {
      if (alive()) setAccountBusy(false);
    }
  };

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
  };
}
