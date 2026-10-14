import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import { confirmAction } from "../api/dialogs";
import { isImeKey } from "../app/keys";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import type { SettingsDto } from "../types/model";
import { hintStyle, labelStyle } from "./SyncFields";

/** 設定ダイアログの右側に並べる部品 (ラベル + 内容)。 */
export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </section>
  );
}

export const Desc = ({ children }: { children: React.ReactNode }) => <div style={hintStyle}>{children}</div>;
export const Row = ({ children }: { children: React.ReactNode }) => <div style={{ display: "flex", gap: "var(--space-2)" }}>{children}</div>;
const ErrorText = ({ children }: { children: React.ReactNode }) => (
  <div role="alert" style={{ ...hintStyle, color: "var(--color-danger)" }}>
    {children}
  </div>
);

/** Storybook (live でない) で出す見た目用のパス。 */
const SAMPLE_DATA_DIR = "~/Documents/PowerToDo/";
const SAMPLE_NAME = "たろう";

/** 画面が閉じた後に state を更新しないためのフラグ。 */
function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/**
 * 「データ」ペイン: データフォルダの表示 / フォルダを開く / 変更。
 * `live` でないとき (Storybook) は見た目だけで何も呼ばない。変更は pick_folder -> 確認 -> set_data_dir の順で、
 * 既存のファイルは移動しない。成功したら `onDataDirChanged` を呼ぶ (プロジェクト一覧を読み直すのは呼び出し側)。
 */
export function DataPane({ live, onDataDirChanged }: { live: boolean; onDataDirChanged?: () => void }) {
  const alive = useAlive();
  const [path, setPath] = useState(live ? "" : SAMPLE_DATA_DIR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    api
      .settings()
      .then((s) => alive.current && setPath(s.dataDir ?? ""))
      .catch((e) => alive.current && setError(errorMessage(e)));
  }, [live, alive]);

  const reveal = () => {
    if (live) void api.revealDataDir().catch((e) => alive.current && setError(errorMessage(e)));
  };

  const change = async () => {
    if (!live || busy) return;
    setBusy(true);
    setError(null);
    try {
      const dir = await api.pickFolder();
      if (!dir || dir === path) return; // キャンセル / 同じ場所
      const ok = await confirmAction(`データフォルダを変更します。既存のファイルは移動しません。\n\n新しい場所: ${dir}`, {
        title: "データフォルダの変更",
        okLabel: "変更する",
      });
      if (!ok) return;
      await api.setDataDir(dir);
      const s = await api.settings().catch(() => null);
      if (alive.current) setPath(s?.dataDir ?? dir);
      onDataDirChanged?.();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Section label="データフォルダ">
      <TextField value={path} readOnly ariaLabel="データフォルダ" />
      <Desc>プロジェクトごとの xlsx ファイルはこのフォルダに保存されます。変更しても既存のファイルは移動しません。</Desc>
      <Row>
        <Button variant="secondary" onClick={reveal}>
          フォルダを開く
        </Button>
        <Button variant="secondary" onClick={() => void change()} disabled={busy}>
          変更
        </Button>
      </Row>
      {error && <ErrorText>{error}</ErrorText>}
    </Section>
  );
}

/** 「アカウント」ペイン: 表示名 (update_settings)。`live` でないときは見た目だけ。 */
export function AccountPane({ live, onDisplayNameChanged }: { live: boolean; onDisplayNameChanged?: (name: string) => void }) {
  const alive = useAlive();
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [name, setName] = useState(live ? "" : SAMPLE_NAME);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    api
      .settings()
      .then((s) => {
        if (!alive.current) return;
        setSettings(s);
        setName(s.displayName);
      })
      .catch((e) => alive.current && setError(errorMessage(e)));
  }, [live, alive]);

  const trimmed = name.trim();
  const dirty = settings !== null && trimmed !== settings.displayName;

  const save = async () => {
    if (!live || !settings || !dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.updateSettings({ ...settings, displayName: trimmed });
      if (!alive.current) return;
      setSettings(next);
      setName(next.displayName);
      setSaved(true);
      onDisplayNameChanged?.(next.displayName);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && isImeKey(e)) e.preventDefault(); // 変換確定の Enter で保存しない (keys.ts)
      }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
    >
      <Section label="表示名">
        <TextField
          value={name}
          ariaLabel="表示名"
          onChange={(v) => {
            setName(v);
            setSaved(false);
          }}
        />
        <Desc>サイドバーのアカウント欄に表示されます。</Desc>
        <Row>
          <Button type="submit" disabled={!dirty || busy}>
            保存
          </Button>
        </Row>
        {saved && !dirty && <Desc>保存しました。</Desc>}
        {error && <ErrorText>{error}</ErrorText>}
      </Section>
    </form>
  );
}

/** まだ中身のないペイン (通知 / 外観 / 日付と時刻 / キーボード)。 */
export function LaterPane() {
  return <Desc>Phase 2 以降</Desc>;
}
