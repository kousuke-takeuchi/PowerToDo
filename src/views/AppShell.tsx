import type React from "react";
import type { SyncState } from "../components/SyncStatus";
import { SidebarRail } from "./SidebarRail";

export type AppShellProps = {
  width?: 1440 | 960 | 390;
  sidebar: React.ReactNode;
  children: React.ReactNode;
  panel?: React.ReactNode;
  overlay?: React.ReactNode;
  banner?: React.ReactNode;
  /** 中央カラムを 800 に絞らず Main いっぱいに広げる (D-10 ボード: padding 40/32)。 */
  fullWidth?: boolean;
  syncState?: SyncState;
};

const HEIGHT = { 1440: 900, 960: 600, 390: 844 } as const;

/**
 * デスクトップのシェル。1440: Sidebar 280 + Main (Column 最大 800 中央) + 任意の panel 400。
 * panel があるとき Main は 760 になり、Column は左右 24 の padding で幅いっぱいに縮む (pen の D-03)。
 * 960: SidebarRail 56 + Main (Column は全幅、padding 24/32)。390 は Main のみ (モバイルは MobileShell を使う)。
 * overflow: hidden はルートだけ。Main / Column はクリップしない (左余白のシェブロンが見えるように)。
 */
export function AppShell({ width = 1440, sidebar, children, panel, overlay, banner, fullWidth, syncState = "synced" }: AppShellProps) {
  const wide = width === 1440;
  const rail = width === 960;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width,
        height: HEIGHT[width],
        overflow: "hidden",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
      }}
    >
      {wide && (
        <aside style={{ flex: "0 0 280px", width: 280, height: "100%", background: "var(--color-bg-sidebar)" }}>{sidebar}</aside>
      )}
      {rail && <SidebarRail syncState={syncState} />}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: wide ? "center" : "stretch",
        }}
      >
        {banner && <div style={{ alignSelf: "stretch" }}>{banner}</div>}
        <div
          style={{
            width: "100%",
            maxWidth: wide && !fullWidth ? 800 : undefined,
            boxSizing: "border-box",
            padding: wide ? (fullWidth ? "40px 32px" : panel ? "40px 24px" : "40px 0") : rail ? "24px 32px" : "16px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {children}
        </div>
      </main>
      {panel && (
        <aside
          style={{
            flex: "0 0 400px",
            width: 400,
            height: "100%",
            borderLeft: "1px solid var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          {panel}
        </aside>
      )}
      {/* ラッパーはクリックを通す。中身 (scrim など) が pointerEvents: "auto" で受ける。中身が null を返しても下を塞がない。 */}
      {overlay && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{overlay}</div>}
    </div>
  );
}
