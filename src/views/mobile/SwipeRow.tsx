import type React from "react";
import { useEffect, useRef } from "react";
import { Calendar, Check, RotateCcw } from "lucide-react";
import { useLongPress, useSwipe } from "../../app/useGestures";
import { EASE_CSS, useMotionTiming } from "../../motion";

export type SwipeRowProps = {
  children: React.ReactNode;
  /** 右へスワイプして離した (完了。done の行は未完了に戻す)。 */
  onComplete?: () => void;
  /** 終わったタスクの行: 右の下地を「未完了に戻す」にする (右へのスワイプは完了の切り替え)。 */
  done?: boolean;
  /** 左へスワイプして離した (日付のシートを開く)。 */
  onDate?: () => void;
  /** 500 ms の長押し (メニューを開く)。 */
  onLongPress?: () => void;
  /**
   * Reorder (spec 2026-11-22): the long press lifts the row instead, at the finger's place. The caller follows the finger
   * and opens the menu itself when it is released without moving. While lifted, the list does not scroll under the finger.
   */
  onLift?: (at: { x: number; y: number }) => void;
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
export function SwipeRow({ children, onComplete, done, onDate, onLongPress, onLift, disabled, initialOffset }: SwipeRowProps) {
  const { reduced } = useMotionTiming();
  const swallow = useRef(false);
  // 長押しが発火したあとのスワイプは捨てる (メニューが開いているのに完了 / 日付が動かない)
  const pressed = useRef(false);
  const swipe = useSwipe({
    onComplete: disabled ? undefined : onComplete,
    onDate: disabled ? undefined : onDate,
  });
  // The finger's last place (where a lift starts) and whether the row is lifted (touchmove must not scroll then).
  const at = useRef({ x: 0, y: 0 });
  const lifted = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !onLift) return;
    // Not passive: once lifted, the drag owns the finger (WebKit decides scrolling on touchmove, not on touch-action alone).
    const stop = (e: TouchEvent) => {
      if (lifted.current) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, [onLift]);
  const press = useLongPress(() => {
    if (disabled || (!onLongPress && !onLift)) return;
    swallow.current = true;
    pressed.current = true;
    if (onLift) {
      lifted.current = true;
      onLift(at.current);
    } else onLongPress?.();
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
          pressed.current = false;
          lifted.current = false;
          at.current = { x: e.clientX, y: e.clientY };
          swipe.bind.onPointerDown(e);
          press.onPointerDown(e);
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
          at.current = { x: e.clientX, y: e.clientY };
          if (!pressed.current) swipe.bind.onPointerMove(e);
          press.onPointerMove(e);
        },
        onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
          if (swipe.active) swallow.current = true;
          if (pressed.current) swipe.bind.onPointerCancel(e);
          else swipe.bind.onPointerUp(e);
          press.onPointerUp(e);
          lifted.current = false;
        },
        onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
          swipe.bind.onPointerCancel(e);
          press.onPointerCancel(e);
          lifted.current = false;
        },
      };

  return (
    <div
      ref={root}
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
        <div aria-hidden style={{ ...panel, left: 0, right: 0, background: done ? "var(--color-text-secondary)" : "var(--color-success)" }}>
          {done ? <RotateCcw size={16} /> : <Check size={16} />}
          <span>{done ? "未完了に戻す" : "完了"}</span>
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
