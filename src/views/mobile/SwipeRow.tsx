import type React from "react";
import { useRef } from "react";
import { Calendar, Check } from "lucide-react";
import { useLongPress, useSwipe } from "../../app/useGestures";
import { EASE_CSS, useMotionTiming } from "../../motion";

export type SwipeRowProps = {
  children: React.ReactNode;
  /** 右へスワイプして離した (完了)。 */
  onComplete?: () => void;
  /** 左へスワイプして離した (日付のシートを開く)。 */
  onDate?: () => void;
  /** 500 ms の長押し (メニューを開く)。 */
  onLongPress?: () => void;
  /** ジェスチャーを受けない (中のクリックはそのまま通る)。 */
  disabled?: boolean;
  /** Story 用: 指を動かしている途中の静止状態 (px。正は右)。 */
  initialOffset?: number;
};

const panel: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "0 16px",
  fontSize: 13,
  lineHeight: "19px",
  fontWeight: 600,
  color: "#FFFFFF", // 色付きの下地の上の白 (SwipeDemo と同じ)
};

/**
 * 行のスワイプ / 長押しのラッパー (仕様 §4.3)。右に動かすと左に緑の「完了」、左に動かすと右に「日付」の下地が見える。
 * 行は user-select: none / -webkit-touch-callout: none (文字選択のメニューを出さない)、touch-action: pan-y (縦はスクロールに任せる)。
 * 長押しの後と横に動かした後に来る click は捨てる (行を開かない)。
 */
export function SwipeRow({ children, onComplete, onDate, onLongPress, disabled, initialOffset }: SwipeRowProps) {
  const { reduced } = useMotionTiming();
  const swallow = useRef(false);
  const swipe = useSwipe({
    onComplete: disabled ? undefined : onComplete,
    onDate: disabled ? undefined : onDate,
  });
  const press = useLongPress(() => {
    if (disabled || !onLongPress) return;
    swallow.current = true;
    onLongPress();
  });
  const offset = initialOffset !== undefined && !swipe.active && swipe.offset === 0 ? initialOffset : swipe.offset;
  const lastSide = useRef<"right" | "left" | null>(null);
  if (offset > 0) lastSide.current = "right";
  else if (offset < 0) lastSide.current = "left";
  const side = lastSide.current;

  const handlers = disabled
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          swallow.current = false;
          swipe.bind.onPointerDown(e);
          press.onPointerDown(e);
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
          swipe.bind.onPointerMove(e);
          press.onPointerMove(e);
        },
        onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
          if (swipe.active) swallow.current = true;
          swipe.bind.onPointerUp(e);
          press.onPointerUp(e);
        },
        onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
          swipe.bind.onPointerCancel(e);
          press.onPointerCancel(e);
        },
      };

  return (
    <div
      {...handlers}
      onClickCapture={(e) => {
        if (swallow.current) {
          swallow.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onContextMenu={disabled ? undefined : (e) => e.preventDefault()}
      style={{
        position: "relative",
        overflow: "hidden",
        touchAction: "pan-y",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {/* 下地は戻るあいだも見えるよう、最後に動かした向きのまま残す (静止時は行が覆う) */}
      {side === "right" ? (
        <div aria-hidden style={{ ...panel, left: 0, right: 0, background: "var(--color-success)" }}>
          <Check size={16} />
          <span>完了</span>
        </div>
      ) : side === "left" ? (
        <div aria-hidden style={{ ...panel, left: 0, right: 0, justifyContent: "flex-end", background: "var(--color-accent)" }}>
          <Calendar size={16} />
          <span>日付</span>
        </div>
      ) : null}
      <div
        style={{
          position: "relative",
          background: "var(--color-bg)",
          transform: offset ? `translateX(${offset}px)` : undefined,
          // 指を離したら元の位置へ戻る (動かしている間は指に付いてくる)
          transition: swipe.active || reduced ? "none" : `transform 200ms ${EASE_CSS}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
