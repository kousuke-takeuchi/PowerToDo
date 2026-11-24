import { useEffect, useRef, useState } from "react";
import { autoScrollSpeed, type Drop, type RowBox } from "../../app/drag/dropTarget";
import { setReorderLock } from "../../app/useGestures";
import { MOBILE_ROW } from "../../components/MobileTaskRow";
import { liftMoved, mobileDrop } from "./mobileReorder";

/** What a reorder row says about itself (data-* on its wrapper; MobileProjectView sets them). */
export type ReorderRowData =
  | { kind: "task"; key: string; no: number; depth: number; parent: number | null; section: string | null }
  | { kind: "header"; section: string }
  | { kind: "slot"; section: string | null };

/** The data-* attributes of a reorder row (read back by the hook when a row is lifted). */
export function reorderAttrs(r: ReorderRowData): Record<string, string> {
  return { "data-reorder-row": JSON.stringify(r) };
}

type Lifted = { key: string; startX: number; startY: number; dragged: Parameters<typeof mobileDrop>[3]; rows: RowBox[] };
export type ReorderState = { key: string; dy: number; line: { y: number; x: number } | null } | null;

/** What to lift: the row's key (project/no), where the finger is, and the subtree that goes with it. */
export type LiftArgs = { key: string; at: { x: number; y: number }; depth: number; height: number; subtree: string[] };

/**
 * Spec 2026-11-22 reorder: long press lifts a row (the caller calls `lift` from SwipeRow's onLift). Moving it drags
 * (the drop is the desktop's, without "onto"); releasing without moving opens the menu instead. The list's scroll body
 * scrolls near its edges. `list` is the element that holds the rows; positions are measured relative to it.
 * `onDrop` gets the drop and the rows as measured at the lift (the caller turns them into a placement, an order, a date).
 */
export function useMobileReorder({ onDrop, onMenu }: { onDrop: (key: string, drop: Drop, rows: RowBox[]) => void; onMenu: (key: string) => void }) {
  const list = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<ReorderState>(null);
  const lifted = useRef<Lifted | null>(null);
  const pointer = useRef({ x: 0, y: 0, moved: false });
  const cb = useRef({ onDrop, onMenu });
  cb.current = { onDrop, onMenu };

  const measure = (): RowBox[] => {
    const el = list.current;
    if (!el) return [];
    const base = el.getBoundingClientRect().top;
    return Array.from(el.querySelectorAll<HTMLElement>("[data-reorder-row]")).map((node) => {
      const r = node.getBoundingClientRect();
      const d = JSON.parse(node.dataset.reorderRow!) as ReorderRowData;
      const box = { top: r.top - base, bottom: r.bottom - base };
      return { ...d, ...box };
    });
  };

  /** Where the finger is now, relative to the list: the drop and its line. */
  const update = () => {
    const l = lifted.current;
    const el = list.current;
    if (!l || !el) return;
    const rect = el.getBoundingClientRect();
    const x = pointer.current.x - rect.left;
    const y = pointer.current.y - rect.top;
    const drop = mobileDrop(l.rows, { x, y }, l.startX, l.dragged, 0);
    const line = drop?.kind === "between" ? { y: drop.y, x: drop.depth * MOBILE_ROW.indent } : null;
    setState({ key: l.key, dy: y - l.startY, line });
  };

  const finish = (commit: boolean) => {
    const l = lifted.current;
    lifted.current = null;
    setReorderLock(false);
    setState(null);
    if (!l || !commit) return;
    if (!pointer.current.moved) {
      cb.current.onMenu(l.key);
      return;
    }
    const el = list.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const drop = mobileDrop(l.rows, { x: pointer.current.x - rect.left, y: pointer.current.y - rect.top }, l.startX, l.dragged, 0);
    if (drop) cb.current.onDrop(l.key, drop, l.rows);
  };

  // While lifted: follow the finger on the window, scroll the body near its edges.
  const active = state !== null;
  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      const l = lifted.current;
      if (!l) return;
      const start = pointer.current;
      if (!start.moved && liftMoved(e.clientX - start.x, e.clientY - start.y)) start.moved = true;
      if (start.moved) {
        pointer.current = { x: e.clientX, y: e.clientY, moved: true };
        update();
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    let frame = 0;
    const tick = () => {
      const body = list.current?.closest<HTMLElement>("[data-scroll-body]");
      if (body && pointer.current.moved) {
        const r = body.getBoundingClientRect();
        const speed = autoScrollSpeed(pointer.current.y, r.top, r.bottom);
        if (speed !== 0) {
          body.scrollTop += speed;
          update();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cancelAnimationFrame(frame);
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  /** SwipeRow's long press: lift the row with this task (its subtree goes with it). */
  const lift = ({ key, at, depth, height, subtree }: LiftArgs) => {
    const el = list.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    lifted.current = {
      key,
      startX: at.x - rect.left,
      startY: at.y - rect.top,
      dragged: { key, depth, height, subtree: new Set(subtree) },
      rows: measure(),
    };
    pointer.current = { x: at.x, y: at.y, moved: false };
    setReorderLock(true);
    setState({ key, dy: 0, line: null });
  };

  return { list, state, lift };
}
