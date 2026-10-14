import type React from "react";
import { useEffect, useState } from "react";
import { isImeKey } from "../app/keys";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
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

/** Storybook (ハンドラ無し) で出す見た目用の値。 */
const SAMPLE_DATA_DIR = "~/Documents/PowerToDo/";
const SAMPLE_NAME = "たろう";

export type DataPaneProps = {
  /** 表示するデータフォルダ。無ければ見た目用のサンプル。 */
  dataDir?: string;
  /** 「フォルダを開く」。 */
  onReveal?: () => void;
  /** 「変更」(フォルダ選択 -> 確認 -> 変更は呼び出し側)。 */
  onChangeFolder?: () => void;
  busy?: boolean;
  error?: string | null;
};

/** 「データ」ペイン: データフォルダの表示 / フォルダを開く / 変更。ハンドラが無いとき (Storybook) は見た目だけ。 */
export function DataPane({ dataDir = SAMPLE_DATA_DIR, onReveal, onChangeFolder, busy = false, error }: DataPaneProps) {
  return (
    <Section label="データフォルダ">
      <TextField value={dataDir} readOnly ariaLabel="データフォルダ" />
      <Desc>プロジェクトごとの xlsx ファイルはこのフォルダに保存されます。変更しても既存のファイルは移動しません。</Desc>
      <Row>
        <Button variant="secondary" onClick={onReveal}>
          フォルダを開く
        </Button>
        <Button variant="secondary" onClick={onChangeFolder} disabled={busy}>
          変更
        </Button>
      </Row>
      {error && <ErrorText>{error}</ErrorText>}
    </Section>
  );
}

export type AccountPaneProps = {
  /** 保存済みの表示名 (入力欄の初期値。変わったら入力欄もこれに戻す)。無ければ見た目用のサンプル。 */
  displayName?: string;
  /** 保存 (前後の空白は除いて渡す)。成功したら true。無いあいだ (Storybook / 読み込み前) は保存できない。 */
  onSaveDisplayName?: (name: string) => Promise<boolean>;
  busy?: boolean;
  error?: string | null;
};

/** 「アカウント」ペイン: 表示名。入力中の文字列だけここで持ち、保存は呼び出し側。 */
export function AccountPane({ displayName = SAMPLE_NAME, onSaveDisplayName, busy = false, error }: AccountPaneProps) {
  const [name, setName] = useState(displayName);
  const [saved, setSaved] = useState(false);

  useEffect(() => setName(displayName), [displayName]);

  const trimmed = name.trim();
  const dirty = !!onSaveDisplayName && trimmed !== displayName;

  const save = async () => {
    if (!onSaveDisplayName || !dirty || busy) return;
    if (await onSaveDisplayName(trimmed)) setSaved(true);
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

/** ショートカット一覧 (仕様 §6)。keys の各要素は同じ動作に割り当てた別々のキー / 組み合わせ。 */
const SHORTCUTS: { keys: string[][]; action: string; note?: string }[] = [
  { keys: [["q"]], action: "クイック追加" },
  { keys: [["Cmd/Ctrl", "K"], ["/"]], action: "検索を開く" },
  { keys: [["g", "t / u / i / l"]], action: "今日 / 近日 / 受信トレイ / フィルターとラベル", note: "g のあと 1 秒以内に押す" },
  { keys: [["↑"], ["↓"]], action: "フォーカス行を上下", note: "折りたたまれた行は飛ばす" },
  { keys: [["Enter"]], action: "フォーカス行の詳細を開く" },
  { keys: [["e"]], action: "フォーカス行を完了 / 取り消し" },
  { keys: [["Delete"], ["Backspace"]], action: "フォーカス行を削除", note: "確認あり" },
  { keys: [["1 - 4"]], action: "優先度" },
  { keys: [["t"], ["m"]], action: "期限を今日 / 明日", note: "時刻は保つ" },
  { keys: [["→"], ["←"]], action: "サブタスクの展開 / 折りたたみ", note: "プロジェクト画面" },
  { keys: [["Esc"]], action: "最上位のレイヤーを閉じる", note: "レイヤーが無ければ行フォーカスを外す" },
];

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  padding: "0 6px",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  lineHeight: "20px",
  color: "var(--color-text-primary)",
  background: "var(--color-bg)",
};

/** 「キーボード」ペイン: ショートカットの一覧。読むだけで操作は無い。入力中 (入力欄・IME 変換中) はどれも効かない。 */
export function KeyboardPane() {
  return (
    // 設定ダイアログは高さが固定なので、一覧が収まらないときはこの中でスクロールする
    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
      <Section label="ショートカット">
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px" }}>
          <tbody>
            {SHORTCUTS.map((row) => (
              <tr key={row.action} style={{ boxShadow: "inset 0 -1px 0 var(--color-border)" }}>
                <td style={{ padding: "6px 12px 6px 0", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {row.keys.map((combo, i) => (
                    <span key={i}>
                      {i > 0 && <span style={{ margin: "0 6px", color: "var(--color-text-muted)" }}>/</span>}
                      {combo.map((k, j) => (
                        <span key={k}>
                          {j > 0 && <span style={{ margin: "0 4px", color: "var(--color-text-muted)" }}>+</span>}
                          <kbd style={kbdStyle}>{k}</kbd>
                        </span>
                      ))}
                    </span>
                  ))}
                </td>
                <td style={{ padding: "6px 0", color: "var(--color-text-primary)" }}>
                  {row.action}
                  {row.note && <div style={{ ...hintStyle, marginTop: 2 }}>{row.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Desc>入力欄にカーソルがあるとき、日本語の変換中は、どのキーも効きません。</Desc>
      </Section>
    </div>
  );
}
