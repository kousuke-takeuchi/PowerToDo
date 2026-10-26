import type React from "react";
import { ChevronLeft, Menu } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { Button } from "./Button";
import { Glass } from "./Glass";
import { titleLook } from "./largeTitle";

export type HeaderAction = { icon: React.ComponentType<{ size?: number }>; label: string; onClick?: () => void };

export type MobileHeaderProps = {
  title: string;
  /** Under the small title (11): 「n 件のタスク」. */
  subtitle?: string;
  /** 0..1 from the list's scroll (screens with a large title). Omitted: the small title shows at once. */
  progress?: MotionValue<number>;
  onBack?: () => void;
  /** Hamburger for the drawer. Removed with the drawer in Task 3. */
  onMenu?: () => void;
  /** Buttons in the glass pill at the right (spec ④ iPhone §3.4). */
  actions?: HeaderAction[];
  /** Replaces the small title, left-aligned (M-03's breadcrumb). `title` becomes its aria-label. */
  breadcrumb?: React.ReactNode;
  /** The top gap is the notch's safe area instead of the picture's 47 status bar. */
  safeArea?: boolean;
};

const actionButton: React.CSSProperties = {
  width: 44,
  height: 44,
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: 0,
  background: "none",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

/** iPhone top bar (spec ④ iPhone §3.3-3.4): back (or menu), the small centered title, the glass pill of actions. */
export function MobileHeader({ title, subtitle, progress, onBack, onMenu, actions, breadcrumb, safeArea }: MobileHeaderProps) {
  const one = useMotionValue(1);
  const smallOpacity = useTransform(progress ?? one, (p) => titleLook(p).smallOpacity);
  return (
    <header style={{ flex: "0 0 auto", background: "var(--color-bg)", fontFamily: "var(--font-body)" }}>
      <div aria-hidden style={{ height: safeArea ? "env(safe-area-inset-top)" : 47 }} />
      <div style={{ position: "relative", height: 52, display: "flex", alignItems: "center", gap: 8, padding: "0 15px" }}>
        {onBack ? (
          <Button variant="icon" icon={ChevronLeft} ariaLabel="戻る" onClick={onBack} />
        ) : onMenu ? (
          <Button variant="icon" icon={Menu} ariaLabel="メニュー" onClick={onMenu} />
        ) : null}
        {breadcrumb ? (
          <div aria-label={title} style={{ flex: 1, minWidth: 0 }}>
            {breadcrumb}
          </div>
        ) : (
          <>
            <motion.div
              data-small-title=""
              aria-hidden={progress ? true : undefined}
              style={{
                position: "absolute",
                left: 72,
                right: 72,
                top: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                opacity: smallOpacity,
                pointerEvents: "none",
              }}
            >
              <div
                role={progress ? undefined : "heading"}
                aria-level={progress ? undefined : 1}
                style={{ maxWidth: "100%", fontSize: 17, lineHeight: "22px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {title}
              </div>
              {subtitle && <div style={{ fontSize: 11, lineHeight: "13px", color: "var(--color-text-secondary)" }}>{subtitle}</div>}
            </motion.div>
            <div style={{ flex: 1 }} />
          </>
        )}
        {actions && actions.length > 0 && (
          <Glass radius={22} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 2px", flex: "0 0 auto" }}>
            {actions.map((a) => (
              <button key={a.label} type="button" aria-label={a.label} onClick={a.onClick} style={actionButton}>
                <a.icon size={20} />
              </button>
            ))}
          </Glass>
        )}
      </div>
    </header>
  );
}
