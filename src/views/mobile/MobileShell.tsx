import type React from "react";
import { useLayoutEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { usePullToRefresh } from "../../app/useGestures";
import { MobileHeader, type HeaderAction } from "../../components/MobileHeader";
import { PullIndicator } from "../../components/PullIndicator";
import type { MobileTab } from "../../app/mobileNav";
import { TAB_BAR, TabBar } from "../../components/TabBar";
import type { TabBarProps } from "../../components/TabBar";
import { LARGE_TITLE_HEIGHT, titleLook, titleProgress } from "../../components/largeTitle";

export type MobileShellProps = {
  /** A custom top bar (M-03's breadcrumb). Without it the shell draws MobileHeader from title / subtitle / actions / onBack. */
  header?: React.ReactNode;
  title?: string;
  /** 「n 件のタスク」 under the large title and under the small title. */
  subtitle?: string;
  /** Spec ④ iPhone §3.3: a large title at the top of the list that moves into the bar as the list scrolls. */
  largeTitle?: boolean;
  actions?: HeaderAction[];
  onBack?: () => void;
  /** Stories: start scrolled by this many px (M-04b). */
  initialScrollTop?: number;
  children: React.ReactNode;
  /** 下部タブ。省略するとタブなし (M-03)。 */
  tab?: MobileTab;
  /** 今日 (YYYY-MM-DD)。タブの「今日」のアイコンの日にち。省略すると端末の日付。 */
  today?: string;
  onTabChange?: TabBarProps["onChange"];
  fab?: boolean;
  onFab?: () => void;
  /** 画面全体に重ねる層 (M-02 のシート)。ラッパーは pointer-events: none、中身側で auto にする。 */
  overlay?: React.ReactNode;
  /** 実機用: 幅 100% / 高さ 100dvh、本文はスクロール、上下の空きはセーフエリア (header 側は MobileHeader の safeArea)。省略すると 390x844 の絵のまま。 */
  fill?: boolean;
  /** header の下、本文の上に置く帯 (通常の流れ。本文はその分だけ縮む)。省略すると何も出さない。 */
  banner?: React.ReactNode;
  /** 本文の先頭で下に引いて離すと呼ぶ (引っ張って更新)。完了を待って目印を畳む。省略すると引いても何もしない。 */
  onRefresh?: () => Promise<void>;
  /** 更新中の目印を強制して出す (Storybook 用)。省略すると onRefresh の実行中だけ出す。 */
  refreshing?: boolean;
}; // 390x844、TabBar 下固定、FAB 56 右下

function LargeTitle({ title, subtitle, progress }: { title: string; subtitle?: string; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, (p) => titleLook(p).largeOpacity);
  const scale = useTransform(progress, (p) => titleLook(p).largeScale);
  return (
    <motion.div data-large-title="" style={{ flex: "0 0 auto", padding: "0 15px 8px", opacity, scale, transformOrigin: "0% 100%" }}>
      <h1 style={{ margin: 0, fontSize: 34, lineHeight: "41px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </h1>
      {subtitle && <div style={{ fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>{subtitle}</div>}
    </motion.div>
  );
}

/**
 * モバイルのシェル 390x844: header + body (flex 1) + TabBar (下)。FAB は右 16 / タブの上 16。
 * overflow: hidden はルートだけ。body はクリップしない。
 */
export function MobileShell({ header, title, subtitle, largeTitle, actions, onBack, initialScrollTop, children, tab, today, onTabChange, fab, onFab, overlay, fill, banner, onRefresh, refreshing: forceRefreshing }: MobileShellProps) {
  const pulling = usePullToRefresh(onRefresh);
  const withPull = onRefresh !== undefined || forceRefreshing !== undefined;
  const progress = useMotionValue(titleProgress(initialScrollTop ?? 0));
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const setBody = (el: HTMLDivElement | null) => {
    scrollEl.current = el;
    pulling.ref(el);
  };
  useLayoutEffect(() => {
    if (initialScrollTop && scrollEl.current) {
      scrollEl.current.scrollTop = initialScrollTop;
      // The body may have less room than asked (clamped, or no scroll event at 0): follow the real position.
      progress.set(titleProgress(scrollEl.current.scrollTop));
    }
  }, [initialScrollTop, progress]);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: fill ? "100%" : 390,
        height: fill ? "100dvh" : 844,
        overflow: "hidden",
        background: "var(--color-bg)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
      }}
    >
      {header ??
        (title !== undefined && (
          <MobileHeader title={title} subtitle={subtitle} progress={largeTitle ? progress : undefined} actions={actions} onBack={onBack} safeArea={fill} />
        ))}
      {banner && <div style={{ flex: "0 0 auto", maxHeight: "40%", overflowY: "auto" }}>{banner}</div>}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {withPull && <PullIndicator pull={pulling.pull} refreshing={forceRefreshing ?? pulling.refreshing} />}
        <div
          ref={setBody}
          data-scroll-body=""
          onScroll={largeTitle ? (e) => progress.set(titleProgress(e.currentTarget.scrollTop)) : undefined}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch" }}
        >
          {largeTitle ? (
            // Like iOS, any list can scroll the full collapse distance, so the title never rests half-faded.
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", minHeight: `calc(100% + ${LARGE_TITLE_HEIGHT}px)` }}>
              {title !== undefined && <LargeTitle title={title} subtitle={subtitle} progress={progress} />}
              {children}
            </div>
          ) : (
            children
          )}
          {tab !== undefined && <div aria-hidden style={{ flex: "0 0 auto", height: TAB_BAR.bottom + TAB_BAR.height + 62 + 24 }} />}
        </div>
      </div>
      {tab !== undefined && (
        <div style={{ position: "absolute", left: TAB_BAR.side, right: TAB_BAR.side, bottom: TAB_BAR.bottom, zIndex: 1 }}>
          <TabBar active={tab} onChange={onTabChange} day={today ? Number(today.slice(8, 10)) : undefined} />
        </div>
      )}
      {fab && (
        <button
          type="button"
          aria-label="タスクを追加"
          onClick={onFab}
          style={{
            position: "absolute",
            right: 18,
            bottom: TAB_BAR.bottom + TAB_BAR.height + 10,
            zIndex: 2,
            width: 62,
            height: 62,
            display: "grid",
            placeItems: "center",
            padding: 0,
            border: 0,
            borderRadius: 31,
            background: "var(--color-accent)",
            boxShadow: "var(--shadow-fab)",
            color: "#FFFFFF", // white on accent
            cursor: "pointer",
          }}
        >
          <Plus size={26} />
        </button>
      )}
      {overlay && <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>{overlay}</div>}
    </div>
  );
}
