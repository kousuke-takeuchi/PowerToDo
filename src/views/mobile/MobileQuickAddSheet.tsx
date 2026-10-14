import type React from "react";
import { motion, useIsPresent } from "motion/react";
import { ArrowUp, Bell, Calendar, Flag, Folder, Tag } from "lucide-react";
import { useEscLayer } from "../../app/layers";
import { useMotionTiming } from "../../motion";
import type { QuickAddToken } from "../QuickAddDialog";

export type MobileQuickAddSheetProps = {
  tokens: QuickAddToken[];
  onClose?: () => void;
};

const tokenColor = { date: "var(--color-success)", priority: "var(--color-priority-1)", project: "var(--color-priority-3)", label: "var(--color-text-secondary)" } as const;

function ToolbarIcon({ icon: Icon, label, color = "var(--color-text-secondary)" }: { icon: React.ComponentType<{ size?: number }>; label: string; color?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={{ width: 32, height: 32, display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: 6, color, cursor: "pointer", flex: "0 0 auto" }}
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
export function MobileQuickAddSheet({ tokens, onClose }: MobileQuickAddSheetProps) {
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
        <div role="group" aria-label="タスク名" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: 16, lineHeight: "23px" }}>
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
        </div>
        <input
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
        />
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <ToolbarIcon icon={Calendar} label="期限" color={of("date") ? "var(--color-success)" : undefined} />
          <ToolbarIcon icon={Flag} label="優先度" color={of("priority") ? "var(--color-priority-1)" : undefined} />
          <ToolbarIcon icon={Bell} label="リマインダー" />
          <ToolbarIcon icon={Tag} label="ラベル" />
          <ToolbarIcon icon={Folder} label="プロジェクト" />
          <div style={{ flex: 1 }} />
          <button
            type="button"
            aria-label="送信"
            style={{
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
      {/* OS のキーボードの代わり。pen の Keyboard (291pt)。色はこのモックだけの固定値 (トークンにしない)。 */}
      <motion.div
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
      </motion.div>
    </motion.div>
  );
}
