import type React from "react";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { AnimatePresence, PresenceContext, animate, motion, useDragControls, useMotionValue, usePresence } from "motion/react";
import { useEscLayer } from "../../app/layers";
import { Glass } from "../../components/Glass";
import { useMotionTiming } from "../../motion";
import { sheetDragEnd, sheetTopGap, sheetTransition, type Detent } from "./sheetMotion";
import { useKeyboardInset } from "./useKeyboardInset";

export type BottomSheetProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Device: lift the sheet by the keyboard's height. */
  fill?: boolean;
  /** A form id: shows the red round check at the top right, which submits that form (sheets that need a decision: TextSheet). */
  confirmForm?: string;
  /** "large": opens at 85 % and pulls up to full height (spec iPhone 5.2). Default: as tall as its content, at most 85 %. */
  size?: "auto" | "large";
};

const round: React.CSSProperties = { width: 36, height: 36, display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: 18, cursor: "pointer", flex: "0 0 auto" };

function Sheet({ title, onClose, children, fill, confirmForm, size = "auto" }: Omit<BottomSheetProps, "open">) {
  const inset = useKeyboardInset(!!fill);
  const [isPresent, safeToRemove] = usePresence();
  // While closing, leave the Esc layer (do not take the Esc of the layer below)
  useEscLayer(isPresent, onClose);
  const { reduced } = useMotionTiming();
  const controls = useDragControls();
  const dragY = useMotionValue(0);
  const [detent, setDetent] = useState<Detent>(size === "large" ? "large" : "auto");
  // A sheet whose content is swapped while open (menu -> move) takes the stop its new size wants in the same commit,
  // so the first frame of the new size already knows where it goes (no frame at the old stop).
  const [shownSize, setShownSize] = useState(size);
  if (shownSize !== size) {
    setShownSize(size);
    setDetent(size === "large" ? "large" : "auto");
  }
  // Once a drag has decided to close, drag must stop fighting the exit animation (a sheet left half-way would never be removed).
  const [leaving, setLeaving] = useState(false);

  // The drag needs pixels (a percentage y is read as px by the drag), so measure the room the sheet has.
  const overlay = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // The top safe area (status bar / notch), read from a hidden probe as tall as env(safe-area-inset-top): the full stop stays below it.
  const safeProbe = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [safeTop, setSafeTop] = useState(0);
  useLayoutEffect(() => {
    const el = overlay.current;
    const probe = safeProbe.current;
    if (!el) return;
    const measure = () => {
      setRoom(el.clientHeight - inset);
      setSafeTop(probe ? probe.offsetHeight : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (probe) ro.observe(probe);
    return () => ro.disconnect();
  }, [inset]);
  const tall = Math.max(0, room - sheetTopGap(safeTop));
  const yLarge = Math.round(tall * 0.15);
  const y = detent === "large" ? yLarge : 0;
  const bottomPad = detent === "large" ? `${yLarge + 16}px` : inset > 0 ? "12px" : "calc(16px + env(safe-area-inset-bottom))";
  const open = sheetTransition("open", reduced);
  const close = sheetTransition("close", reduced);

  // y is driven here, not by initial/animate/exit: the off-screen start and end are the sheet's own height (plus its stop),
  // measured in the same layout pass, so the whole spring is on screen whatever the sheet's height.
  // Already open on BottomSheet's first render (AnimatePresence initial={false}): no open motion.
  const presence = useContext(PresenceContext);
  const openedWithParent = useRef(presence?.initial === false);
  const played = useRef<string | null>(null);
  const ready = room > 0;
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el || !isPresent) return;
    if (played.current !== size) {
      // First open, or a size swap (menu -> move): from just below the screen, the open spring to the new stop.
      const still = reduced || (played.current === null && openedWithParent.current);
      played.current = size;
      if (still) {
        dragY.jump(y);
        return;
      }
      dragY.jump(el.offsetHeight + y); // jump, not set: set() would give the spring a huge downward start velocity
      animate(dragY, y, sheetTransition("open", false));
      return;
    }
    // A new stop (drag release, room resize): the stop motion.
    if (dragY.get() !== y) animate(dragY, y, sheetTransition("detent", reduced));
  }, [ready, size, y, reduced, isPresent, dragY]);
  // Closing: down by the sheet's own height (plus its stop), then let AnimatePresence remove it.
  useEffect(() => {
    if (isPresent) return;
    const el = sheet.current;
    dragY.stop();
    if (!el || reduced) {
      safeToRemove?.();
      return;
    }
    animate(dragY, Math.max(el.offsetHeight + y, dragY.get()), close).then(() => safeToRemove?.());
    // Runs once, when the sheet starts leaving.
  }, [isPresent]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <motion.div
      ref={overlay}
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: open }}
      exit={{ opacity: 0, transition: close }}
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
      <div ref={safeProbe} aria-hidden data-safe-top-probe style={{ position: "absolute", top: 0, left: 0, width: 0, height: "env(safe-area-inset-top, 0px)", visibility: "hidden", pointerEvents: "none" }} />
      {room > 0 && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title ?? "シート"}
          ref={sheet}
          drag={leaving || !isPresent ? false : "y"}
          dragControls={controls}
          dragListener={false}
          dragMomentum={false}
          dragConstraints={{ top: y, bottom: y }}
          dragElastic={{ top: detent === "large" ? 0.6 : 0.05, bottom: 1 }}
          onDragEnd={(_, info) => {
            const out = sheetDragEnd(detent, info.offset.y, info.velocity.y);
            if (out === "close") {
              dragY.stop(); // the release animation (back to the stop) must not fight the exit
              setLeaving(true);
              onClose();
            } else {
              setDetent(out);
            }
          }}
          style={{
            y: dragY,
            position: "relative",
            boxSizing: "border-box",
            height: size === "large" ? tall : undefined,
            maxHeight: size === "large" ? undefined : "85%",
            display: "flex",
            flexDirection: "column",
            background: "var(--color-sheet-bg)",
            color: "var(--color-text-primary)",
            borderRadius: "16px 16px 0 0",
            flex: "0 0 auto",
          }}
        >
          {/* Grabber + title row: the drag handle (the content may scroll, so it does not start drags) */}
          <div onPointerDown={(e) => controls.start(e)} style={{ flex: "0 0 auto", touchAction: "none", padding: "6px 15px 8px" }}>
            <div aria-hidden style={{ margin: "0 auto 6px", width: 36, height: 4, borderRadius: 2, background: "var(--color-border)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Glass radius={18} style={{ flex: "0 0 auto" }}>
                <button type="button" aria-label="閉じる" onClick={onClose} style={{ ...round, background: "none", color: "var(--color-text-primary)" }}>
                  <X size={18} />
                </button>
              </Glass>
              <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 17, lineHeight: "22px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
              {confirmForm ? (
                <button type="submit" form={confirmForm} aria-label="決定" style={{ ...round, background: "var(--color-accent)", color: "#FFFFFF" /* white on accent */ }}>
                  <Check size={18} />
                </button>
              ) : (
                <span aria-hidden style={{ width: 36, flex: "0 0 auto" }} />
              )}
            </div>
          </div>
          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              // At the 85 % stop the bottom 15 % is below the screen: pad it so the end of a long list can be scrolled into view.
              padding: `4px 15px ${bottomPad}`,
            }}
          >
            {children}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * Spec iPhone 5.1-5.2: a sheet from the bottom. It has a grabber, a glass x, the title and an optional check, with content as cards on grey.
 * It opens with a no-bounce spring, closes in 0.13 s, and the header drags it (down closes; "large" pulls up to full).
 * The content can be swapped while open (menu -> date). Already open on the first render: no motion.
 */
export function BottomSheet({ open, ...rest }: BottomSheetProps) {
  return <AnimatePresence initial={false}>{open && <Sheet key="sheet" {...rest} />}</AnimatePresence>;
}

/** A white card on the sheet's grey ground (spec iPhone 5.1). Rows inside get hairlines (`.sheet-card`, direct children only). `label` makes it an aria group. */
export function SheetCard({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="sheet-card" role={label ? "group" : undefined} aria-label={label} style={{ background: "var(--color-sheet-card)", borderRadius: 16, overflow: "hidden", flex: "0 0 auto" }}>
      {children}
    </div>
  );
}

/** One row of a sheet card (48 px tall). */
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
      style={{
        width: "100%",
        minHeight: 48,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "0 16px",
        border: 0,
        borderRadius: 0,
        background: selected ? "var(--color-bg-hover)" : "transparent",
        fontFamily: "var(--font-body)",
        fontSize: 16,
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
