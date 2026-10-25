import type React from "react";
import { createContext } from "react";

/** Where a page's header actions go (the right side of the top bar). PageHeader portals into it; null outside AppShell. */
export const TopBarSlot = createContext<HTMLElement | null>(null);

/**
 * The bar above the page (Todoist): left, the sidebar button when the sidebar is hidden; right, the page's actions
 * (表示 / その他), filled by PageHeader through `TopBarSlot`. Sticky at the top of the scrolling main.
 */
export function TopBar({ left, slotRef }: { left?: React.ReactNode; slotRef: (el: HTMLElement | null) => void }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        alignSelf: "stretch",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        flex: "0 0 48px",
        padding: "0 16px",
        boxSizing: "border-box",
        background: "var(--color-bg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>{left}</div>
      <div ref={slotRef} style={{ display: "flex", alignItems: "center" }} />
    </div>
  );
}
