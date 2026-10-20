import { LoaderCircle, RefreshCw } from "lucide-react";
import { PULL_TRIGGER } from "../app/gestures";

export type PullIndicatorProps = {
  /** 指で引いている量 (px)。0 で隠れる。 */
  pull?: number;
  /** 更新中: 回るアイコンを上に留める。 */
  refreshing?: boolean;
};

/** 引っ張って更新の目印。本文の上に重ねる (位置は絶対配置で、本文は動かさない: iOS のバウンスに任せる)。親は position: relative。 */
export function PullIndicator({ pull = 0, refreshing = false }: PullIndicatorProps) {
  const progress = Math.min(pull / (PULL_TRIGGER / 2), 1);
  const shown = refreshing || pull > 0;
  return (
    <div aria-hidden={!refreshing} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 0, zIndex: 1, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <span
        role={refreshing ? "status" : undefined}
        aria-label={refreshing ? "更新中" : undefined}
        style={{
          display: "grid",
          placeItems: "center",
          width: 32,
          height: 32,
          marginTop: 8,
          borderRadius: 16,
          background: "var(--color-bg)",
          boxShadow: "var(--shadow-popover)",
          color: "var(--color-text-secondary)",
          opacity: shown ? (refreshing ? 1 : progress) : 0,
          transform: `translateY(${refreshing ? 0 : shown ? Math.min(pull, 56) - 8 : -40}px)`,
          transition: pull > 0 ? undefined : "transform 150ms ease, opacity 150ms ease",
        }}
      >
        {refreshing ? (
          <span style={{ display: "inline-flex", animation: "spin 1s linear infinite" }}>
            <LoaderCircle size={18} />
          </span>
        ) : (
          <span style={{ display: "inline-flex", transform: `rotate(${progress * 180}deg)` }}>
            <RefreshCw size={18} />
          </span>
        )}
      </span>
    </div>
  );
}
