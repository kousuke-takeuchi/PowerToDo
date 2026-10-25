import type React from "react";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTiming } from "../motion";
import type { SyncState } from "../components/SyncStatus";
import type { SidebarRailProps } from "./SidebarRail";
import { TopBar, TopBarSlot } from "./TopBar";

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
  /** Left side of the top bar (the sidebar button while the sidebar is hidden). */
  topBarLeft?: React.ReactNode;
  /** Wide layout: the sidebar is closed (slides to width 0). */
  sidebarHidden?: boolean;
  /** Stories: the pixel width of the shell, overriding `width` (the layout still follows `width`). */
  widthPx?: number;
  /** No longer drawn: the narrow layout hides the sidebar instead of showing the icon rail. Kept so callers compile. */
  rail?: Pick<SidebarRailProps, "onExpand" | "onAddTask" | "onNavigate" | "lastSyncedAt" | "syncDetail" | "syncOffText" | "syncErrorText" | "syncPausedText" | "onSyncClick">;
};

const HEIGHT = { 1440: 900, 960: 600, 390: 844 } as const;
const PANEL_WIDTH = 400;

/**
 * デスクトップのシェル。1440: Sidebar 280 + Main (Column 最大 800 中央) + 任意の panel 400。
 * panel があるとき Main は 760 になり、Column は左右 24 の padding で幅いっぱいに縮む (pen の D-03)。
 * 960: SidebarRail 56 + Main (Column は全幅、padding 24/32)。390 は Main のみ (モバイルは MobileShell を使う)。
 * overflow: hidden はルートだけ。Main / Column はクリップしない (左余白のシェブロンが見えるように)。
 */
export function AppShell({ width = 1440, sidebar, children, panel, overlay, banner, fullWidth, fill, topBarLeft, sidebarHidden, widthPx }: AppShellProps) {
  const wide = width === 1440;
  const { reduced, t } = useMotionTiming();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: fill ? "100%" : (widthPx ?? width),
        height: fill ? "100vh" : HEIGHT[width],
        overflow: "hidden",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
      }}
    >
      {wide && (
        // Hiding slides the sidebar to width 0 in 0.3 s (Todoist); the centered column moves with it.
        <motion.aside
          initial={false}
          animate={{ width: sidebarHidden ? 0 : 280 }}
          transition={t(0.3)}
          style={{ flex: "0 0 auto", height: "100%", overflow: "hidden", background: "var(--color-bg-sidebar)" }}
        >
          <div style={{ width: 280, height: "100%" }}>{sidebar}</div>
        </motion.aside>
      )}
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
        <TopBar left={topBarLeft} slotRef={setSlot} />
        {banner && <div style={{ alignSelf: "stretch" }}>{banner}</div>}
        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
            // Left room for what sits left of the column (section chevron -28, subtask chevron -24, drag handle -40):
            // `main` scrolls, so it clips anything left of it. Once the 800 column fills `main`, keep 44 / 24 like narrow.
            padding: wide
              ? fullWidth
                ? "8px 32px 40px"
                : panel
                  ? "8px 24px 40px 44px"
                  : "8px max(24px, calc((100% - 800px) / 2)) 40px max(44px, calc((100% - 800px) / 2))"
              : "8px 24px 16px 44px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <TopBarSlot.Provider value={slot}>{children}</TopBarSlot.Provider>
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
      {overlay && <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}>{overlay}</div>}
    </div>
  );
}
