import type React from "react";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
}; // 390x844、TabBar 下固定、FAB 56 右下

/**
 * モバイルのシェル 390x844: header + body (flex 1) + TabBar (下)。FAB は右 16 / タブの上 16。
 * overflow: hidden はルートだけ。body はクリップしない。
 */
export function MobileShell({ header, children, tab, onTabChange, fab, onFab, overlay, fill, banner }: MobileShellProps) {
  // 選択中のタブはシェルが持つ (見た目だけ。画面遷移は Story を切り替える)。tab が変わったらそれに合わせる。
  // onTabChange があるとき (実画面) は持たずに tab をそのまま出す (「一覧」はドロワーを開くだけで選択は移らない)。
  const [cur, setCur] = useState(tab);
  useEffect(() => setCur(tab), [tab]);
  const shownTab = onTabChange ? tab : cur;
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
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          ...(fill ? { overflowY: "auto", overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch" } : null),
        }}
      >
        {children}
      </div>
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
