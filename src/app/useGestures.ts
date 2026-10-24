import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionTiming } from "../motion";
import { LONG_PRESS_MS, PULL_TRIGGER, axisLock, decidePull, decideSwipe, longPressCancelled } from "./gestures";
import type { Axis } from "./gestures";

/** 行に付けるポインターのハンドラー (React の onPointer*)。 */
export type PointerHandlers = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
};

type Start = { id: number; x: number; y: number };

/**
 * 行の横スワイプ (仕様 §4.3)。判定は gestures.ts の純関数だけが行い、ここは動きを測って渡す。
 * 軸が決まる前と縦のときは何もしない (setPointerCapture もしないので、スクロールを奪わない)。横が決まったら capture して行を指に追わせる。
 * 発動は指を離したとき。指を離す / 中断すると offset は 0 に戻る (戻りの動きは呼び出し側が offset の変化に付ける)。
 */
export function useSwipe({ onComplete, onDate }: { onComplete?: () => void; onDate?: () => void }): { bind: PointerHandlers; offset: number; active: boolean } {
  const start = useRef<Start | null>(null);
  const axis = useRef<Axis | null>(null);
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(false);
  // 指を離した時点の最新の関数を使う (再描画の間に変わる)
  const cb = useRef({ onComplete, onDate });
  cb.current = { onComplete, onDate };

  const reset = useCallback(() => {
    start.current = null;
    axis.current = null;
    setActive(false);
    setOffset(0);
  }, []);

  const bind: PointerHandlers = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      axis.current = null;
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (axis.current === null) {
        axis.current = axisLock(dx, dy);
        if (axis.current === "x") {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // capture できなくても動きは追える
          }
          setActive(true);
        }
      }
      if (axis.current === "x") {
        e.preventDefault();
        setOffset(dx);
      }
    },
    onPointerUp: (e) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const decision = decideSwipe(axis.current, e.clientX - s.x);
      reset();
      if (decision === "complete") cb.current.onComplete?.();
      else if (decision === "date") cb.current.onDate?.();
    },
    onPointerCancel: (e) => {
      if (start.current?.id === e.pointerId) reset();
    },
  };
  return { bind, offset, active };
}

/** 500 ms 動かさずに押し続けると onLongPress。LONG_PRESS_SLOP 動いたら取りやめる。指を離す / 中断でも取りやめる。 */
export function useLongPress(onLongPress: () => void): PointerHandlers {
  const timer = useRef<number | null>(null);
  const start = useRef<Start | null>(null);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;
  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  return {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      clear();
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        start.current = null;
        cb.current();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      if (longPressCancelled(e.clientX - s.x, e.clientY - s.y)) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}

/**
 * 一覧の先頭で下へ引いて離すと onRefresh (仕様 §4.3)。判定は gestures.ts の decidePull だけが行い、ここは動きを測って渡す。
 *
 * ポインターではなく touch イベントで測る。実機 (iOS) の touch は、ブラウザが縦のスクロールを始めると pointercancel を送り、
 * 引きが指を離すところまで届かない。touch イベントはネイティブのスクロール / バウンスの間も touchmove を送り続けるので、
 * スクロールを奪わずに (listener は passive、preventDefault しない) 引きの量を測れる。先頭での引きは本文の overscroll-behavior: contain で
 * ブラウザの更新に渡さない。先頭かどうかは押した時点と今の scrollTop (要素のスクロールなので 0 に丸められる) の両方で見る。
 * 中断 (touchcancel: システムのジェスチャーなど) は、そこまでの引きで離したものとして扱う (decidePull が閾値未満なら何もしない)。
 * refreshing の間は新しい引きを受けない。onRefresh が undefined のときは何も聞かない。
 * 戻り値の ref を、縦にスクロールする要素 (本文) に付ける。
 */
export function usePullToRefresh(onRefresh: (() => Promise<void>) | undefined): { ref: (el: HTMLElement | null) => void; pull: number; refreshing: boolean } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { reduced } = useMotionTiming();
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const busy = useRef(false);
  const enabled = onRefresh !== undefined;

  useEffect(() => {
    if (!el || !enabled) return;
    let start: { x: number; y: number; atTop: boolean } | null = null;
    let axis: Axis | null = null;
    let dy = 0;
    const reset = () => {
      start = null;
      axis = null;
      dy = 0;
      setPull(0);
    };
    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1) {
        start = null;
        return;
      }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, atTop: el.scrollTop <= 0 };
      axis = null;
      dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      dy = t.clientY - start.y;
      if (axis === null) axis = axisLock(dx, dy);
      // 引いている間に本文が動いたら (先頭でなくなったら) 引きではない
      if (el.scrollTop > 0) start.atTop = false;
      if (axis === "y" && start.atTop && dy > 0) setPull(reducedRef.current ? 0 : Math.min(dy / 2, PULL_TRIGGER * 1.5));
      else setPull(0);
    };
    const onEnd = () => {
      const s = start;
      const go = !!s && decidePull(s.atTop && el.scrollTop <= 0, axis, dy);
      reset();
      if (!go || busy.current || !cb.current) return;
      busy.current = true;
      setRefreshing(true);
      cb.current()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
          setRefreshing(false);
        });
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      setPull(0);
    };
  }, [el, enabled]);

  return { ref: setEl, pull, refreshing };
}
