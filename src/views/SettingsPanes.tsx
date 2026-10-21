import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { isImeKey } from "../app/keys";
import { Button } from "../components/Button";
import { Segmented } from "../components/Segmented";
import { TextField } from "../components/TextField";
import { NarrowContext } from "../components/NarrowContext";
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
export const Row = ({ children }: { children: React.ReactNode }) => {
  const narrow = useContext(NarrowContext);
  return narrow ? (
    // 縦に並べると、flex の stretch でボタンが全幅になる
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>{children}</div>
  ) : (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>{children}</div>
  );
};
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
  const narrow = useContext(NarrowContext);

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
          fontSize={narrow ? 16 : undefined}
          ariaLabel="表示名"
          onChange={(v) => {
            setName(v);
            setSaved(false);
          }}
        />
        <Desc>{narrow ? "ドロワーのアカウント欄に表示されます。" : "サイドバーのアカウント欄に表示されます。"}</Desc>
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

const ON_OFF = [
  { value: "on", label: "オン" },
  { value: "off", label: "オフ" },
] as const;

/** Linux ではウィンドウを閉じるとアプリが終了する (Rust 側がトレイ常駐を使わない)。 */
function isLinux(): boolean {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return ua.includes("Linux") && !ua.includes("Android");
}

export type NotificationsPaneProps = {
  enabled: boolean;
  onToggle?: (v: boolean) => void;
  keepInTray: boolean;
  onToggleKeepInTray?: (v: boolean) => void;
  /** トレイを作れなかった理由 (あれば「トレイに残す」は使えない)。 */
  trayError?: string;
  /** 設定を読み込むまで操作できない。 */
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
};

/**
 * 「通知」ペイン: 通知のオン / オフ、閉じたときトレイに残す。変更は呼び出し側がすぐ保存する。
 * OS の権限は出さない: デスクトップの通知プラグインは常に「許可済み」と答え、実際に出るかは OS の通知設定で決まる。
 */
export function NotificationsPane({
  enabled,
  onToggle,
  keepInTray,
  onToggleKeepInTray,
  trayError,
  loading = false,
  busy = false,
  error,
}: NotificationsPaneProps) {
  const linux = isLinux();
  const trayDisabled = !!trayError || linux;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {loading && !error && <Desc>読み込み中…</Desc>}
      <Section label="通知">
        <Segmented
          options={[...ON_OFF]}
          value={enabled ? "on" : "off"}
          onChange={(v) => !busy && onToggle?.(v === "on")}
          ariaLabel="通知"
          disabled={loading}
        />
        <Desc>リマインダーの時刻になると OS の通知を出します。オフでもアプリ内の帯は出ます。</Desc>
        <Desc>{"通知の表示は OS の通知設定で決まります (macOS: システム設定 > 通知 > PowerToDo)"}</Desc>
      </Section>
      <Section label="閉じたときトレイに残す">
        <Segmented
          options={[...ON_OFF]}
          value={keepInTray && !trayDisabled ? "on" : "off"}
          onChange={(v) => !busy && onToggleKeepInTray?.(v === "on")}
          ariaLabel="閉じたときトレイに残す"
          disabled={loading || trayDisabled}
        />
        <Desc>オンにすると、ウィンドウを閉じてもトレイに残り、通知が届きます。トレイの「終了」で終了します。</Desc>
        {trayError && <Desc>{trayError}</Desc>}
        {linux && <Desc>Linux ではウィンドウを閉じるとアプリが終了します (トレイに残す設定は使われません)。</Desc>}
      </Section>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

const REMINDER_OPTIONS = [
  { value: "none", label: "なし", code: null },
  { value: "-0m", label: "同時刻", code: "-0m" },
  { value: "-10m", label: "10 分前", code: "-10m" },
  { value: "-30m", label: "30 分前", code: "-30m" },
  { value: "-60m", label: "1 時間前", code: "-60m" },
  { value: "-1d", label: "前日", code: "-1d" },
] as const;

const WEEK_START_OPTIONS = [
  { value: "mon", label: "月曜" },
  { value: "sun", label: "日曜" },
] as const;

export type DateTimePaneProps = {
  /** リマインダーコード (例 "-10m")。null = なし。 */
  defaultReminder: string | null;
  onChangeDefaultReminder?: (v: string | null) => void;
  /** 時刻なしのタスクを通知する時刻 "HH:MM"。 */
  notifyTime: string;
  /** 保存の結果を返せるなら成功したかどうか (false なら入力欄を保存済みの値に戻す)。 */
  onChangeNotifyTime?: (v: string) => Promise<boolean> | void;
  weekStart: "mon" | "sun";
  onChangeWeekStart?: (v: "mon" | "sun") => void;
  /** 設定を読み込むまで操作できない。 */
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
};

/** 「日付と時刻」ペイン: 既定リマインダー / 時刻なしの通知時刻 / 週の開始。変更は呼び出し側がすぐ保存する (時刻だけは入力欄を離れるか Enter で)。 */
export function DateTimePane({
  defaultReminder,
  onChangeDefaultReminder,
  notifyTime,
  onChangeNotifyTime,
  weekStart,
  onChangeWeekStart,
  loading = false,
  busy = false,
  error,
}: DateTimePaneProps) {
  // 時刻入力は打っている途中の値 (draft) を持ち、入力欄を離れたとき / Enter で確定する。
  const [draft, setDraft] = useState(notifyTime);
  const focused = useRef(false);
  /** 最後に保存へ送った値 (結果待ちを含む)。保存済みの props より新しいことがある。 */
  const sent = useRef(notifyTime);
  const saved = useRef(notifyTime);
  saved.current = notifyTime;
  useEffect(() => {
    sent.current = notifyTime;
    if (!focused.current) setDraft(notifyTime);
  }, [notifyTime]);

  const commit = async () => {
    const v = draft;
    if (!/^\d{2}:\d{2}$/.test(v)) {
      setDraft(saved.current); // 空 / 途中の値は捨てて保存済みに戻す
      return;
    }
    if (v === sent.current) return;
    sent.current = v;
    const ok = await onChangeNotifyTime?.(v);
    if (ok === false) {
      sent.current = saved.current;
      setDraft(saved.current);
    }
  };

  const known = REMINDER_OPTIONS.find((o) => o.code === defaultReminder);
  const reminderValue = known?.value ?? "other";
  const reminderOptions: { value: string; label: string }[] = REMINDER_OPTIONS.map(({ value, label }) => ({ value, label }));
  // 一覧に無いコード (別の版や手編集で入った値) は 7 つ目に出す。押しても何も変えない。
  if (!known) reminderOptions.push({ value: "other", label: `その他 (${defaultReminder})` });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {loading && !error && <Desc>読み込み中…</Desc>}
      <Section label="既定リマインダー">
        <Segmented
          options={reminderOptions}
          value={reminderValue}
          onChange={(v) => {
            const o = REMINDER_OPTIONS.find((x) => x.value === v);
            if (!busy && o) onChangeDefaultReminder?.(o.code);
          }}
          ariaLabel="既定リマインダー"
          disabled={loading}
        />
        <Desc>時刻付きの期限を入れたタスクに自動で付けます。タスクごとに変えられます。</Desc>
      </Section>
      <Section label="時刻なしの通知時刻">
        <input
          type="time"
          value={draft}
          disabled={loading}
          aria-label="時刻なしの通知時刻"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeKey(e)) {
              e.preventDefault();
              void commit();
            }
          }}
          className="outline-none border-[color:var(--color-border)] focus-visible:border-[color:var(--color-accent)]"
          style={{
            boxSizing: "border-box",
            width: 140,
            padding: "7px 11px",
            borderRadius: "var(--radius)",
            borderWidth: 1,
            borderStyle: "solid",
            background: "transparent",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            lineHeight: "20px",
            opacity: loading ? 0.5 : 1,
          }}
        />
        <Desc>期限に時刻が無いタスクは、この時刻に通知します。</Desc>
      </Section>
      <Section label="週の開始">
        <Segmented
          options={[...WEEK_START_OPTIONS]}
          value={weekStart}
          onChange={(v) => !busy && onChangeWeekStart?.(v)}
          ariaLabel="週の開始"
          disabled={loading}
        />
      </Section>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

/** まだ中身のないペイン (通知 / 外観 / 日付と時刻)。予定の Phase は全体設計書 §9 の段階分けに合わせる。 */
const LATER: Record<"notifications" | "appearance" | "datetime", string> = {
  notifications: "通知はリマインダーと一緒に Phase 3 で実装予定",
  appearance: "外観 (ダークテーマ) は Phase 5 で実装予定",
  datetime: "日付と時刻の設定は後の Phase で実装予定",
};

export function LaterPane({ pane }: { pane: keyof typeof LATER }) {
  return <Desc>{LATER[pane]}</Desc>;
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
