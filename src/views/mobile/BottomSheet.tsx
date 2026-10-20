import type React from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useEscLayer } from "../../app/layers";
import { useMotionTiming } from "../../motion";
import { useKeyboardInset } from "./useKeyboardInset";

export type BottomSheetProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 実機用: キーボードの高さぶん持ち上げる (入力欄のあるシートが、キーボードで隠れないように)。省略すると今のまま。 */
  fill?: boolean;
};

function Sheet({ title, onClose, children, fill }: Omit<BottomSheetProps, "open">) {
  const inset = useKeyboardInset(!!fill);
  // 閉じるアニメーション中は Esc レイヤーから外す (下のレイヤーの Esc を奪わない)
  useEscLayer(useIsPresent(), onClose);
  const { reduced, t } = useMotionTiming();
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={t(0.15)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        background: "var(--color-scrim)",
        pointerEvents: "auto",
        fontFamily: "var(--font-body)",
        paddingBottom: inset > 0 ? inset : undefined,
        boxSizing: "border-box",
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "シート"}
        initial={{ y: reduced ? 0 : "100%" }}
        animate={{ y: 0 }}
        exit={{ y: reduced ? 0 : "100%" }}
        transition={t(0.25)}
        style={{
          boxSizing: "border-box",
          maxHeight: "85%",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          // キーボードが出ている間 (inset > 0) は、キーボードの上端が下端なのでセーフエリアは空けない
          padding: `var(--space-2) var(--space-4) ${inset > 0 ? "var(--space-3)" : "calc(var(--space-3) + env(safe-area-inset-bottom))"}`,
          background: "var(--color-bg)",
          color: "var(--color-text-primary)",
          borderRadius: "16px 16px 0 0",
          flex: "0 0 auto",
        }}
      >
        <div aria-hidden style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, background: "var(--color-border)", flex: "0 0 auto" }} />
        {title && (
          <div style={{ fontSize: 13, lineHeight: "19px", fontWeight: 600, color: "var(--color-text-secondary)", overflowWrap: "anywhere" }}>{title}</div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * 下からせり上がるシート (250 ms)。scrim のタップ / Esc で閉じる。下はセーフエリアぶん空ける。MobileShell の overlay に入れる。
 * 開いたまま中身 (children) を入れ替えられる (メニュー -> 日付のシート)。最初の描画で既に開いているときは動かさない。
 */
export function BottomSheet({ open, title, onClose, children, fill }: BottomSheetProps) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <Sheet key="sheet" title={title} onClose={onClose} fill={fill}>
          {children}
        </Sheet>
      )}
    </AnimatePresence>
  );
}

/** シートの 1 行 (44 pt 以上のタップ領域)。 */
export function SheetRow({
  icon,
  iconColor = "var(--color-text-secondary)",
  label,
  value,
  selected,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  iconColor?: string;
  label: string;
  value?: string;
  selected?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={{
        width: "100%",
        minHeight: 44,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "0 8px",
        border: 0,
        borderRadius: 8,
        background: selected ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
        fontSize: 15,
        lineHeight: "22px",
        textAlign: "left",
        color: danger ? "var(--color-danger)" : "var(--color-text-primary)",
        cursor: "pointer",
      }}
    >
      {icon && <span style={{ display: "inline-flex", color: danger ? "var(--color-danger)" : iconColor }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      {value && <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{value}</span>}
    </button>
  );
}
