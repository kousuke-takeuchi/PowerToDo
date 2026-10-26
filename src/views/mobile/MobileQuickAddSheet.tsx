import type React from "react";
import { useRef, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import { ArrowUp, Bell, Calendar, Flag, Hash, Plus, Tag } from "lucide-react";
import { isImeKey } from "../../app/keys";
import { useEscLayer } from "../../app/layers";
import { reminderLabel } from "../ReminderPicker";
import type { InsertKind } from "../../app/quickAddInsert";
import { useMotionTiming } from "../../motion";
import { COVERED_SCALE, sheetTransition } from "./sheetMotion";
import { useKeyboardInset } from "./useKeyboardInset";
import type { QuickAddToken } from "../QuickAddDialog";

export type MobileQuickAddSheetProps = {
  tokens: QuickAddToken[];
  onClose?: () => void;
  /** 実機用: 入力欄 (16px) を出し、キーボードの上にシートを置く (visualViewport)。省略すると Story の見た目 (入力欄なし、キーボード領域 291)。 */
  fill?: boolean;
  text?: string;
  onTextChange?: (text: string) => void;
  /** Enter または送信ボタン。空 / busy の間は呼ばない。 */
  onSubmit?: (text: string) => void;
  busy?: boolean;
  error?: string;
  /** ツールバー (日付 / 優先度 / ラベル / リマインダー) が押されたとき。入力欄の末尾に語を足すのは呼び出し側。 */
  onInsert?: (kind: InsertKind) => void;
  /** リマインダー (クイック追加の構文に無い): 選んだコード。ボタンは onPickReminder で別のシートを開く。 */
  reminders?: string[];
  onPickReminder?: () => void;
  /** プロジェクトのチップに出す名前 (省略すると 受信トレイ)。#名前 を打つとそちらが優先される。 */
  projectName?: string;
  /** リマインダーのシートが上に重なっている (カードを 0.95 に縮めて暗くする)。 */
  covered?: boolean;
};

const ellipsis: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const noShrink: React.CSSProperties = { flexShrink: 0 };

/** A chip of the quick add's bottom row (spec ④ iPhone §5.3). Pressing it keeps the keyboard up.
 *  `shrink`: the date and project chips give way (text ellipsizes) so the send button stays inside the card. */
function Chip({ label, onClick, color = "var(--color-text-secondary)", pressed, shrink, children }: { label: string; onClick?: () => void; color?: string; pressed?: boolean; shrink?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 32, maxWidth: 110, padding: "0 8px", border: "1px solid var(--color-border)", borderRadius: 8, background: pressed ? "var(--color-bg-hover)" : "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", color, whiteSpace: "nowrap", overflow: "hidden", cursor: "pointer", flex: shrink ? "0 1 auto" : "0 0 auto", minWidth: shrink ? 0 : undefined }}
    >
      {children}
    </button>
  );
}

const tokenColor = { date: "var(--color-success)", priority: "var(--color-priority-1)", project: "var(--color-priority-3)", label: "var(--color-text-secondary)" } as const;

function ToolbarIcon({
  icon: Icon,
  label,
  color = "var(--color-text-secondary)",
  onClick,
  size = 32,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  color?: string;
  onClick?: () => void;
  /** タップ領域。実機は 44 pt。 */
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      // 押してもキーボードを閉じない (入力欄のフォーカスを保つ)
      onMouseDown={(e) => e.preventDefault()}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={{ width: size, height: size, display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: 6, color, cursor: "pointer", flex: "0 0 auto" }}
    >
      <Icon size={18} />
    </button>
  );
}

/**
 * M-02: 画面下から出る入力シート + キーボード領域 (291)。MobileShell の overlay スロットに入れる。
 * 背面の scrim (タップで onClose) の下端にシートを置き、その下にキーボード領域を続ける。
 * シートの下端 = キーボードの上端なので、シートは常に全体が見える。保存はしない。
 * scrim は pointerEvents: "auto" (MobileShell の overlay ラッパーは "none")。
 */
export function MobileQuickAddSheet({ tokens, onClose, fill, text, onTextChange, onSubmit, busy, error, onInsert, reminders = [], onPickReminder, projectName, covered }: MobileQuickAddSheetProps) {
  const live = onTextChange !== undefined;
  const ts = live ? 44 : 32;
  const inset = useKeyboardInset(!!fill);
  const input = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (live && onSubmit && !busy && (text ?? "").trim()) onSubmit(text ?? "");
  };
  const insert = (kind: InsertKind) => {
    onInsert?.(kind);
    input.current?.focus();
  };
  // 閉じるアニメーション中は Esc レイヤーから外す (下のレイヤーの Esc を奪わない)。
  useEscLayer(useIsPresent(), () => onClose?.());
  // Open: the measured spring; close: 0.13 s ease-in (sheetMotion). Reduced motion: no movement.
  const { reduced } = useMotionTiming();
  const open = sheetTransition("open", reduced);
  const close = sheetTransition("close", reduced);
  const [more, setMore] = useState(false);
  const tokenText = (kind: NonNullable<QuickAddToken["kind"]>) => tokens.find((t) => t.kind === kind)?.text.trim();
  const dateTok = tokenText("date");
  const prioNo = /^p([1-4])$/i.exec(tokenText("priority") ?? "")?.[1];
  const projTok = tokenText("project")?.replace(/^#/, "");
  const parsed = tokens.filter((t) => t.kind);
  const card: React.CSSProperties = { boxSizing: "border-box", margin: "0 10px", background: "var(--color-sheet-card)", boxShadow: "var(--shadow-popover)" };
  const slide = { initial: { y: reduced ? 0 : "120%" }, animate: { y: 0, transition: open }, exit: { y: reduced ? 0 : "120%", transition: close } };
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: open }}
      exit={{ opacity: 0, transition: close }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        background: "var(--color-scrim)",
        pointerEvents: "auto",
        fontFamily: "var(--font-body)",
        // 実機: キーボードの高さぶん持ち上げる。キーボードが無いときはセーフエリアぶん空ける。
        // Device: float 10 above the keyboard (or above the home indicator when the keyboard is down). Story: the keyboard mock follows.
        paddingBottom: fill ? (inset > 0 ? inset + 10 : "calc(env(safe-area-inset-bottom) + 10px)") : 0,
        boxSizing: "border-box",
      }}
    >
      <motion.div
        {...slide}
        animate={{ y: 0, scale: covered ? COVERED_SCALE : 1, transition: open }}
        style={{ display: "flex", flexDirection: "column", gap: 8, transformOrigin: "50% 100%" }}
      >
        {live && (parsed.length > 0 || reminders.length > 0) && (
          // Spec ④ iPhone §5.3: what the text was read as, in a card floating above (the existing parsed tokens and reminders)
          <div role="group" aria-label="解釈" style={{ ...card, borderRadius: 16, padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: 4, fontSize: 13, lineHeight: "19px" }}>
            {parsed.map((t, i) => (
              <span key={i} style={{ padding: "1px 6px", borderRadius: 4, background: "var(--color-bg-hover)", color: tokenColor[t.kind!] }}>
                {t.text}
              </span>
            ))}
            {reminders.map((c) => (
              <span key={c} style={{ padding: "1px 6px", borderRadius: 4, background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}>
                {reminderLabel(c)}
              </span>
            ))}
          </div>
        )}
        <div role="dialog" aria-modal="true" aria-label="クイック追加" style={{ ...card, position: "relative", borderRadius: 24, padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        {live && (
          <input
            ref={input}
            aria-label="タスク名"
            placeholder="タスク名 (例: 牛乳 明日 p1)"
            value={text ?? ""}
            autoFocus
            enterKeyHint="send"
            onChange={(e) => onTextChange?.(e.target.value)}
            onKeyDown={(e) => {
              // 日本語変換を確定する Enter では送信しない (keys.ts)
              if (e.key === "Enter" && !isImeKey(e)) submit();
            }}
            className="placeholder:text-[var(--color-text-muted)]"
            style={{
              boxSizing: "border-box",
              width: "100%",
              height: 26,
              padding: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-body)",
              fontSize: 20,
              lineHeight: "26px",
              color: "var(--color-text-primary)",
            }}
          />
        )}
          {live && error && (
            <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)" }}>
              {error}
            </div>
          )}
          {!live && <div role="group" aria-label="タスク名" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: 20, lineHeight: "26px" }}>
            {tokens.map((t, i) =>
              t.kind ? (
                <span key={i} style={{ padding: "1px 4px", borderRadius: 4, whiteSpace: "pre", background: "var(--color-bg-hover)", color: tokenColor[t.kind] }}>
                  {t.text}
                </span>
              ) : (
                <span key={i} style={{ whiteSpace: "pre", color: "var(--color-text-primary)" }}>
                  {t.text}
                </span>
              ),
            )}
            <span aria-hidden style={{ width: 2, height: 24, background: "var(--color-text-primary)", flex: "0 0 auto" }} />
          </div>}
          {!live && <input
            aria-label="説明"
            placeholder="説明"
            className="placeholder:text-[var(--color-text-muted)]"
            style={{
              boxSizing: "border-box",
              width: "100%",
              height: 20,
              padding: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              lineHeight: "20px",
              color: "var(--color-text-primary)",
            }}
          />}
          {more && (
            <div style={{ display: "flex", gap: 4 }}>
              <ToolbarIcon icon={Tag} label="ラベル" size={ts} onClick={live ? () => insert("label") : undefined} />
              <ToolbarIcon icon={Bell} label="リマインダー" size={ts} color={reminders.length > 0 ? "var(--color-success)" : undefined} onClick={onPickReminder} />
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Chip label="その他の項目" pressed={more} onClick={() => setMore((v) => !v)}>
              <Plus size={16} />
            </Chip>
            <Chip label="日付" shrink onClick={live ? () => insert("date") : undefined} color={dateTok === "今日" ? "var(--color-success)" : dateTok ? "var(--color-text-primary)" : undefined}>
              <Calendar size={16} style={noShrink} />
              <span style={ellipsis}>{dateTok ?? "日付"}</span>
            </Chip>
            <Chip label="優先度" onClick={live ? () => insert("priority") : undefined} color={prioNo ? "var(--color-text-primary)" : undefined}>
              <Flag size={16} color={prioNo ? `var(--color-priority-${prioNo})` : undefined} />
              {prioNo ? `P${prioNo}` : "優先度"}
            </Chip>
            <Chip label="プロジェクト" shrink onClick={live ? () => insert("project") : undefined}>
              <Hash size={16} style={noShrink} />
              <span style={ellipsis}>{projTok ?? projectName ?? "受信トレイ"}</span>
            </Chip>
            {/* marginLeft auto, not a spacer div: a spacer costs one more 6 px gap, which the defaults (日付 / 受信トレイ) don't have at 390. */}
            <button
              type="button"
              aria-label="送信"
              onClick={live ? submit : undefined}
              onMouseDown={(e) => e.preventDefault()}
              disabled={live && (busy || !(text ?? "").trim())}
              style={{
                opacity: live && (busy || !(text ?? "").trim()) ? 0.4 : 1,
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                padding: 0,
                border: 0,
                borderRadius: 18,
                background: "var(--color-accent)",
                color: "#FFFFFF", // pen と同じ (アクセント上の白)
                cursor: "pointer",
                flex: "0 0 auto",
                marginLeft: "auto",
              }}
            >
              <ArrowUp size={18} />
            </button>
          </div>
          <motion.div
            aria-hidden
            initial={false}
            animate={{ opacity: covered ? 1 : 0 }}
            transition={sheetTransition("detent", reduced)}
            style={{ position: "absolute", inset: 0, borderRadius: 24, background: "var(--color-scrim)", pointerEvents: covered ? "auto" : "none" }}
          />
        </div>
      </motion.div>
      {/* OS のキーボードの代わり。pen の Keyboard (291pt)。色はこのモックだけの固定値 (トークンにしない)。実機 (fill) では出さない。 */}
      {!fill && <motion.div
        aria-hidden
        {...slide}
        style={{
          marginTop: 10,
          height: 291,
          flex: "0 0 291px",
          display: "grid",
          placeItems: "center",
          background: "#D1D4DA",
          color: "#6E6E73",
          fontSize: 12,
          lineHeight: "17px",
        }}
      >
        キーボード領域 (291pt)
      </motion.div>}
    </motion.div>
  );
}
