import type React from "react";
import { useState } from "react";
import { motion } from "motion/react";
import { useMotionTiming } from "../motion";
import type { SyncState } from "../components/SyncStatus";
import type { SidebarRailProps } from "./SidebarRail";
import { TopBar, TopBarSlot } from "./TopBar";

export type AppShellProps = {
  width?: 1440 | 960 | 390;
  sidebar: React.ReactNode;
  children: React.ReactNode;
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

/**
 * デスクトップのシェル。1440: Sidebar 280 + Main (Column 最大 800 中央)。タスクの詳細は overlay のダイアログ (spec ①)。
 * 960: SidebarRail 56 + Main (Column は全幅、padding 24/32)。390 は Main のみ (モバイルは MobileShell を使う)。
 * overflow: hidden はルートだけ。Main / Column はクリップしない (左余白のシェブロンが見えるように)。
 */
export function AppShell({ width = 1440, sidebar, children, overlay, banner, fullWidth, fill, topBarLeft, sidebarHidden, widthPx }: AppShellProps) {
  const wide = width === 1440;
  const { t } = useMotionTiming();
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
      {/* ラッパーはクリックを通す。中身 (scrim など) が pointerEvents: "auto" で受ける。中身が null を返しても下を塞がない。 */}
      {overlay && <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}>{overlay}</div>}
    </div>
  );
}
