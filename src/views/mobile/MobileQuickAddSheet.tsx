import type React from "react";
import { useEffect, useRef, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import { ArrowUp, Bell, Calendar, Flag, Folder, Tag } from "lucide-react";
import { isImeKey } from "../../app/keys";
import { useEscLayer } from "../../app/layers";
import type { InsertKind } from "../../app/quickAddInsert";
import { useMotionTiming } from "../../motion";
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
};

/** キーボードで隠れる高さ (px)。visualViewport が無い / 隠れていないときは 0。 */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return inset;
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
export function MobileQuickAddSheet({ tokens, onClose, fill, text, onTextChange, onSubmit, busy, error, onInsert }: MobileQuickAddSheetProps) {
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
  // シートとキーボード領域は下からせり上がる (250ms)。scrim は 150ms でフェード。reduced motion では動かさない。
  const { reduced, t } = useMotionTiming();
  const slide = { initial: { y: reduced ? 0 : "100%" }, animate: { y: 0 }, exit: { y: reduced ? 0 : "100%" }, transition: t(0.25) };

  const of = (kind: NonNullable<QuickAddToken["kind"]>) => tokens.some((t) => t.kind === kind);
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={t(0.15)}
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
        paddingBottom: fill ? (inset > 0 ? inset : "env(safe-area-inset-bottom)") : undefined,
        boxSizing: "border-box",
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="クイック追加"
        {...slide}
        style={{
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--color-bg)",
          borderRadius: "16px 16px 0 0",
          flex: "0 0 auto",
        }}
      >
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
              height: 28,
              padding: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-body)",
              fontSize: 16, // 16px 未満だと iOS が拡大する
              lineHeight: "24px",
              color: "var(--color-text-primary)",
            }}
          />
        )}
        {live && tokens.some((t) => t.kind) && (
          <div role="group" aria-label="解釈" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", fontSize: 13, lineHeight: "19px" }}>
            {tokens
              .filter((t) => t.kind)
              .map((t, i) => (
                <span key={i} style={{ padding: "1px 6px", borderRadius: 4, background: "var(--color-bg-hover)", color: tokenColor[t.kind!] }}>
                  {t.text}
                </span>
              ))}
          </div>
        )}
        {live && error && (
          <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)" }}>
            {error}
          </div>
        )}
        {!live && <div role="group" aria-label="タスク名" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: 16, lineHeight: "23px" }}>
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
          <span aria-hidden style={{ width: 2, height: 20, background: "var(--color-text-primary)", flex: "0 0 auto" }} />
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
        <div style={{ display: "flex", alignItems: "center", gap: live ? 0 : "var(--space-2)" }}>
          <ToolbarIcon icon={Calendar} label="期限" size={ts} color={of("date") ? "var(--color-success)" : undefined} onClick={live ? () => insert("date") : undefined} />
          <ToolbarIcon icon={Flag} label="優先度" size={ts} color={of("priority") ? "var(--color-priority-1)" : undefined} onClick={live ? () => insert("priority") : undefined} />
          {live ? (
            <>
              <ToolbarIcon icon={Tag} label="ラベル" size={ts} onClick={() => insert("label")} />
              <ToolbarIcon icon={Bell} label="リマインダー" size={ts} onClick={() => insert("reminder")} />
            </>
          ) : (
            <>
              <ToolbarIcon icon={Bell} label="リマインダー" />
              <ToolbarIcon icon={Tag} label="ラベル" />
            </>
          )}
          <ToolbarIcon icon={Folder} label="プロジェクト" size={ts} />
          <div style={{ flex: 1 }} />
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
            }}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </motion.div>
      {/* OS のキーボードの代わり。pen の Keyboard (291pt)。色はこのモックだけの固定値 (トークンにしない)。実機 (fill) では出さない。 */}
      {!fill && <motion.div
        aria-hidden
        {...slide}
        style={{
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
