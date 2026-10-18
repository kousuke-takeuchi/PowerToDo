import type React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTiming } from "../motion";
import type { SyncState } from "../components/SyncStatus";
import { SidebarRail } from "./SidebarRail";
import type { SidebarRailProps } from "./SidebarRail";

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
  /** 実アプリ用: ウィンドウいっぱいに広げる (width は 1440 / 960 のレイアウトの選択だけに使い、中央カラムはスクロールする)。 */
  fill?: boolean;
  /** 960 のとき SidebarRail に渡すハンドラ (Storybook は渡さない)。 */
  rail?: Pick<SidebarRailProps, "onExpand" | "onAddTask" | "onNavigate" | "lastSyncedAt" | "syncDetail" | "onSyncClick">;
};

const HEIGHT = { 1440: 900, 960: 600, 390: 844 } as const;
const PANEL_WIDTH = 400;

/**
 * デスクトップのシェル。1440: Sidebar 280 + Main (Column 最大 800 中央) + 任意の panel 400。
 * panel があるとき Main は 760 になり、Column は左右 24 の padding で幅いっぱいに縮む (pen の D-03)。
 * 960: SidebarRail 56 + Main (Column は全幅、padding 24/32)。390 は Main のみ (モバイルは MobileShell を使う)。
 * overflow: hidden はルートだけ。Main / Column はクリップしない (左余白のシェブロンが見えるように)。
 */
export function AppShell({ width = 1440, sidebar, children, panel, overlay, banner, fullWidth, syncState = "synced", fill, rail: railProps }: AppShellProps) {
  const wide = width === 1440;
  const rail = width === 960;
  const { reduced, t } = useMotionTiming();
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: fill ? "100%" : width,
        height: fill ? "100vh" : HEIGHT[width],
        overflow: "hidden",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
      }}
    >
      {wide && (
        <aside style={{ flex: "0 0 280px", width: 280, height: "100%", background: "var(--color-bg-sidebar)" }}>{sidebar}</aside>
      )}
      {rail && <SidebarRail syncState={syncState} {...railProps} />}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: wide ? "center" : "stretch",
          overflowY: fill ? "auto" : undefined,
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
      {/* 詳細パネル: 右から x 24 -> 0 + フェード (200ms)。幅も 0 <-> 400 で動かし、本文の列が開閉に合わせて縮む / 広がる。
          中身は幅 400 のまま右寄せ (アニメーション中だけ overflow: hidden)。最初から開いている描画 (Storybook) では動かさない。 */}
      <AnimatePresence initial={false}>
        {panel && (
          <motion.aside
            key="panel"
            initial={{ opacity: 0, x: reduced ? 0 : 24, width: 0, overflow: "hidden" }}
            animate={{ opacity: 1, x: 0, width: PANEL_WIDTH, transitionEnd: { overflow: "visible" } }}
            exit={{ opacity: 0, x: reduced ? 0 : 24, width: 0, overflow: "hidden" }}
            transition={t(0.2)}
            style={{ flex: "0 0 auto", height: "100%", display: "flex", justifyContent: "flex-end" }}
          >
            <div
              style={{
                flex: `0 0 ${PANEL_WIDTH}px`,
                width: PANEL_WIDTH,
                height: "100%",
                boxSizing: "border-box",
                borderLeft: "1px solid var(--color-border)",
                background: "var(--color-bg)",
              }}
            >
              {panel}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {/* ラッパーはクリックを通す。中身 (scrim など) が pointerEvents: "auto" で受ける。中身が null を返しても下を塞がない。 */}
      {overlay && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{overlay}</div>}
    </div>
  );
}
