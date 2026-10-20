import type React from "react";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { usePullToRefresh } from "../../app/useGestures";
import { PullIndicator } from "../../components/PullIndicator";
import { TabBar } from "../../components/TabBar";
import type { TabBarProps } from "../../components/TabBar";

export type MobileShellProps = {
  header: React.ReactNode;
  children: React.ReactNode;
  /** 下部タブ。省略するとタブなし (M-03)。"none" はタブを出して選択なし (M-07)。 */
  tab?: TabBarProps["active"] | "none";
  onTabChange?: TabBarProps["onChange"];
  fab?: boolean;
  onFab?: () => void;
  /** 画面全体に重ねる層 (M-02 のシート、M-06 のドロワー)。ラッパーは pointer-events: none、中身側で auto にする。 */
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

/**
 * モバイルのシェル 390x844: header + body (flex 1) + TabBar (下)。FAB は右 16 / タブの上 16。
 * overflow: hidden はルートだけ。body はクリップしない。
 */
export function MobileShell({ header, children, tab, onTabChange, fab, onFab, overlay, fill, banner, onRefresh, refreshing: forceRefreshing }: MobileShellProps) {
  const pulling = usePullToRefresh(onRefresh);
  const withPull = onRefresh !== undefined || forceRefreshing !== undefined;
  // 選択中のタブはシェルが持つ (見た目だけ。画面遷移は Story を切り替える)。tab が変わったらそれに合わせる。
  // onTabChange があるとき (実画面) は持たずに tab をそのまま出す (「一覧」はドロワーを開くだけで選択は移らない)。
  const [cur, setCur] = useState(tab);
  useEffect(() => setCur(tab), [tab]);
  const shownTab = onTabChange ? tab : cur;
  const bodyStyle: React.CSSProperties = {
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    ...(fill ? { overflowY: "auto", overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch" } : null),
  };
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
      {header}
      {banner && <div style={{ flex: "0 0 auto", maxHeight: "40%", overflowY: "auto" }}>{banner}</div>}
      {withPull ? (
        // 目印を重ねるための枠 (本文は動かさない)。引きは本文 (スクロールする要素) の touch イベントで測る
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <PullIndicator pull={pulling.pull} refreshing={forceRefreshing ?? pulling.refreshing} />
          <div ref={pulling.ref} style={{ ...bodyStyle, flex: 1 }}>
            {children}
          </div>
        </div>
      ) : (
        <div style={{ ...bodyStyle, flex: 1 }}>{children}</div>
      )}
      {tab !== undefined && (
        <div style={{ position: "relative", zIndex: 1, flex: "0 0 auto" }}>
          <TabBar
            safeArea={fill}
            active={shownTab === "none" ? undefined : shownTab}
            onChange={(id) => {
              setCur(id);
              onTabChange?.(id);
            }}
          />
        </div>
      )}
      {fab && (
        <button
          type="button"
          aria-label="タスクを追加"
          onClick={onFab}
          style={{
            position: "absolute",
            right: 16,
            bottom: fill ? "calc(56px + env(safe-area-inset-bottom) + 16px)" : 90 + 16,
            zIndex: 2,
            width: 56,
            height: 56,
            display: "grid",
            placeItems: "center",
            padding: 0,
            border: 0,
            borderRadius: 28,
            background: "var(--color-accent)",
            boxShadow: "var(--shadow-fab)",
            color: "#FFFFFF", // pen と同じ (アクセント上の白)
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
