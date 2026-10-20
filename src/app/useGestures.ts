import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionTiming } from "../motion";
import { LONG_PRESS_MS, axisLock, decidePull, decideSwipe, longPressCancelled } from "./gestures";
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

/** el から上へたどって、縦にスクロールする最初の要素 (なければ null)。 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * 一覧の先頭で下へ引いて離すと onRefresh (仕様 §4.3)。先頭かどうかは押した時点のスクロール位置で決め、縦に決まった引きだけ pull に出す。

 * 注意: 実機の touch は、ブラウザが縦のスクロールを始めると pointercancel になる (引きは届かない)。配線するときは実機で確かめ、必要なら先頭でだけ touch-action を外す。
 * 引いている間は capture しない (ブラウザのスクロールに任せ、先頭での引きは overscroll-behavior で止める)。refreshing の間は新しい引きを受けない。
 */
export function usePullToRefresh(onRefresh: () => Promise<void>): { bind: PointerHandlers; pull: number; refreshing: boolean } {
  const start = useRef<(Start & { atTop: boolean }) | null>(null);
  const axis = useRef<Axis | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { reduced } = useMotionTiming();
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const busy = useRef(false);

  const reset = () => {
    start.current = null;
    axis.current = null;
    setPull(0);
  };
  const bind: PointerHandlers = {
    onPointerDown: (e) => {
      if (busy.current || (e.pointerType === "mouse" && e.button !== 0)) return;
      const sp = scrollParent(e.currentTarget);
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, atTop: !sp || sp.scrollTop <= 0 };
      axis.current = null;
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (axis.current === null) axis.current = axisLock(dx, dy);
      if (axis.current === "y" && s.atTop && dy > 0) setPull(reduced ? 0 : dy / 2);
    },
    onPointerUp: (e) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const go = decidePull(s.atTop, axis.current, e.clientY - s.y);
      reset();
      if (!go || busy.current) return;
      busy.current = true;
      setRefreshing(true);
      cb.current()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
          setRefreshing(false);
        });
    },
    onPointerCancel: (e) => {
      if (start.current?.id === e.pointerId) reset();
    },
  };
  return { bind, pull, refreshing };
}
