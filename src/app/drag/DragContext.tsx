import type React from "react";
import { createContext, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Placement, Task } from "../../types/model";
import { EASE_CSS, useMotionTiming } from "../../motion";
import { autoScrollSpeed, computeDrop, orderIndex, placementOf, todayInPlace, type Drop, type RowBox } from "./dropTarget";

export type DragSource =
  | { kind: "task"; task: Task; view: "project" | "today" | "upcoming" | "label"; depth: number; height: number; subtree: Set<string> }
  | { kind: "section"; project: string; name: string }
  | { kind: "project"; name: string };
type TaskSource = Extract<DragSource, { kind: "task" }>;
export type DropResult =
  | { kind: "place"; source: TaskSource; placement: Placement }
  | { kind: "today"; source: TaskSource; beforeKey: string | null }
  | { kind: "day"; source: TaskSource; date: string }
  | { kind: "project"; source: TaskSource; project: string }
  | { kind: "sections"; project: string; names: string[] }
  | { kind: "projects"; names: string[] };
export type DragApi = { start: (e: React.PointerEvent, source: DragSource, card: React.ReactNode) => void; active: DragSource | null };

export const DragCtx = createContext<DragApi | null>(null);

const LIFT = 4;
/** Room left of a list for the drag grips (-40 from the column edge). */
const GUTTER = 48;
const SETTLE = 0.15;
type Target =
  | { kind: "list"; drop: Drop; rows: RowBox[]; list: "project" | "today"; right: number }
  | { kind: "project"; name: string; rect: DOMRect }
  | { kind: "day"; date: string; rect: DOMRect }
  | { kind: "order"; attr: "section" | "project"; names: string[]; index: number; y: number; x: number; w: number };
type Card = { node: React.ReactNode; left: number; top: number; w: number };
/** Per-move state. It lives in DragLayer so the provider (and every DragCtx consumer) does not re-render per move. */
type LayerState = { card: Card | null; target: Target | null; settle: { left: number; top: number } | null };
type SetLayer = React.Dispatch<React.SetStateAction<LayerState>>;
const EMPTY: LayerState = { card: null, target: null, settle: null };

function rowBoxes(list: Element): RowBox[] {
  return [...list.querySelectorAll<HTMLElement>("[data-row]")].map((el) => {
    const r = el.getBoundingClientRect();
    const d = el.dataset;
    const section = d.section ? d.section : null;
    if (d.rowKind === "header") return { kind: "header", section: d.section ?? "", top: r.top, bottom: r.bottom };
    if (d.rowKind === "slot") return { kind: "slot", section, top: r.top, bottom: r.bottom };
    return { kind: "task", key: d.key!, no: Number(d.no), depth: Number(d.depth), parent: d.parent ? Number(d.parent) : null, section, top: r.top, bottom: r.bottom };
  });
}

const rowEl = (key: string) => document.querySelector<HTMLElement>(`[data-row][data-key="${CSS.escape(key)}"]`);

/** Where the card settles on a committed drop: the red line, the ring or the highlight. */
function dropPoint(t: Target): { left: number; top: number } | null {
  if (t.kind === "list" && t.drop.kind === "between") return { left: t.drop.x, top: t.drop.y };
  if (t.kind === "list" && t.drop.kind === "onto") {
    const r = rowEl(t.drop.key)?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top } : null;
  }
  if (t.kind === "project" || t.kind === "day") return { left: t.rect.left, top: t.rect.top };
  return t.kind === "order" ? { left: t.x, top: t.y } : null;
}

/**
 * The click after a lifted drag must not open the row under it (it lands on the pressed element through pointer capture).
 * One-shot capture-phase listener; removed on the next tick, or after the next pointerup when the button is still down.
 */
function suppressClick(pressed: boolean) {
  const block = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    remove();
  };
  const later = () => setTimeout(remove, 0);
  const remove = () => {
    window.removeEventListener("click", block, true);
    window.removeEventListener("pointerup", later, true);
    window.removeEventListener("pointerdown", remove, true);
  };
  window.addEventListener("click", block, true);
  if (pressed) {
    window.addEventListener("pointerup", later, true);
    window.addEventListener("pointerdown", remove, true);
  } else later();
}

const line = (y: number, x: number, w: number) => (
  <div style={{ position: "fixed", left: x - 4, top: y - 1, width: w, height: 2, background: "var(--color-accent)", pointerEvents: "none", zIndex: 81 }}>
    <span style={{ position: "absolute", left: 0, top: -3, width: 8, height: 8, boxSizing: "border-box", borderRadius: 4, border: "2px solid var(--color-accent)", background: "var(--color-bg)" }} />
  </div>
);
const ring = (r: { left: number; top: number; width: number; height: number }, fill: boolean) => (
  <div style={{ position: "fixed", left: r.left, top: r.top, width: r.width, height: r.height, borderRadius: 6, pointerEvents: "none", zIndex: 79, boxShadow: fill ? undefined : "inset 0 0 0 1px var(--color-accent)", background: fill ? "var(--color-drop-highlight)" : undefined }} />
);

/** The card, the red line / ring / highlight, and the settle motion (spec ③ §2.4, ~0.15 s, instant with reduced motion). */
const DragLayer = memo(function DragLayer({ bind, settleRef }: { bind: React.MutableRefObject<SetLayer | null>; settleRef: React.MutableRefObject<number> }) {
  const [s, set] = useState<LayerState>(EMPTY);
  const { t } = useMotionTiming();
  const duration = t(SETTLE).duration;
  useLayoutEffect(() => {
    bind.current = set;
    return () => void (bind.current = null);
  }, [bind]);
  useLayoutEffect(() => {
    settleRef.current = duration;
  }, [settleRef, duration]);
  useEffect(() => {
    if (!s.settle) return;
    const id = setTimeout(() => set(EMPTY), duration * 1000 + 20);
    return () => clearTimeout(id);
  }, [s.settle, duration]);

  const { card, target, settle } = s;
  if (!card && !target) return null;

  let indicator: React.ReactNode = null;
  if (!settle) {
    if (target?.kind === "list" && target.drop.kind === "between") {
      // The list under the pointer (the board has one per column), not the first one on the page.
      indicator = line(target.drop.y, target.drop.x, target.right - target.drop.x);
    } else if (target?.kind === "list" && target.drop.kind === "onto") {
      const el = rowEl(target.drop.key);
      if (el) indicator = ring(el.getBoundingClientRect(), false);
    } else if (target?.kind === "project" || target?.kind === "day") {
      indicator = ring(target.rect, true);
    } else if (target?.kind === "order") {
      indicator = line(target.y, target.x + 4, target.w - 8);
    }
  }

  return createPortal(
    <>
      {indicator}
      {card && (
        <div
          style={{
            position: "fixed",
            left: settle ? settle.left : card.left,
            top: settle ? settle.top : card.top,
            opacity: settle ? 0 : 1,
            transition: settle ? `left ${duration}s ${EASE_CSS}, top ${duration}s ${EASE_CSS}, opacity ${duration}s ${EASE_CSS}` : undefined,
            width: card.w,
            pointerEvents: "none",
            zIndex: 80,
            background: "var(--color-bg)",
            borderRadius: 6,
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {card.node}
        </div>
      )}
    </>,
    document.body,
  );
});

type DragState = { source: DragSource; sx: number; sy: number; lifted: boolean; node: React.ReactNode; rect: DOMRect; key?: string; pointerId: number };

/** Spec ③ §2: lift after 4 px, a card follows the pointer, a red line (or a ring / highlight) shows the target. */
export function DragProvider({ onDrop, children }: { onDrop: (r: DropResult) => void; children: React.ReactNode }) {
  const [active, setActive] = useState<DragSource | null>(null);
  const drag = useRef<DragState | null>(null);
  const targetRef = useRef<Target | null>(null);
  const pointer = useRef({ x: 0, y: 0, buttons: 0 });
  const layer = useRef<SetLayer | null>(null);
  const settleRef = useRef(SETTLE);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const find = useCallback((x: number, y: number): Target | null => {
    const d = drag.current;
    if (!d) return null;
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (d.source.kind === "task") {
      const proj = el.closest<HTMLElement>("[data-drop-project]");
      if (proj) return { kind: "project", name: proj.dataset.dropProject!, rect: proj.getBoundingClientRect() };
      const day = el.closest<HTMLElement>("[data-drop-day]");
      if (day && d.source.view === "upcoming") return { kind: "day", date: day.dataset.dropDay!, rect: day.getBoundingClientRect() };
      const list = el.closest<HTMLElement>("[data-drop-list]");
      const kind = list?.dataset.dropList as "project" | "today" | undefined;
      if (list && kind && kind === d.source.view) {
        const rows = rowBoxes(list);
        const listRect = list.getBoundingClientRect();
        const left = listRect.left + Number(list.dataset.level0 ?? 0);
        const s = d.source;
        const dragged = kind === "today" ? { key: d.key!, depth: 0, height: 2, subtree: s.subtree } : { key: d.key!, depth: s.depth, height: s.height, subtree: s.subtree };
        const drop = computeDrop(rows, { x, y }, d.sx, dragged, left);
        return drop ? { kind: "list", drop, rows, list: kind, right: listRect.right } : null;
      }
      return null;
    }
    // Sections / projects: a line between items of the same list, only while the pointer is over that list.
    const attr = d.source.kind === "section" ? "section" : "project";
    const listEl = document.querySelector(d.source.kind === "section" ? "[data-section-list]" : "[data-project-list]");
    if (!listEl) return null;
    const items = [...listEl.querySelectorAll<HTMLElement>(attr === "section" ? "[data-drop-section]" : "[data-project-item]")];
    const names = items.map((it) => (attr === "section" ? it.dataset.dropSection! : it.dataset.projectItem!));
    const lr = listEl.getBoundingClientRect();
    // The grip sits in the gutter left of the column, so a straight pull up from it must stay inside the list.
    const at = orderIndex(items.map((it) => it.getBoundingClientRect()), { left: lr.left - GUTTER, right: lr.right, top: lr.top, bottom: lr.bottom }, x, y);
    return at ? { kind: "order", attr, names, index: at.index, y: at.y, x: lr.left, w: lr.width } : null;
  }, []);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const scroller = document.querySelector<HTMLElement>("[data-drag-scroll]");
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const v = autoScrollSpeed(pointer.current.y, r.top, r.bottom);
        if (v) {
          scroller.scrollTop += v;
          const t = find(pointer.current.x, pointer.current.y);
          targetRef.current = t;
          layer.current?.((s) => ({ ...s, target: t }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, find]);

  /** `pressed`: the button may still be down (Esc, blur), so the click to swallow comes with a later pointerup. */
  const end = useCallback((commit: boolean, pressed = false) => {
    const d = drag.current;
    const t = targetRef.current;
    drag.current = null;
    targetRef.current = null;
    setActive(null);
    document.body.style.userSelect = "";
    if (d?.lifted) suppressClick(pressed);
    const result = commit && d?.lifted && t ? resultOf(d, t) : null;
    if (result) onDropRef.current(result);
    // Committed drop: the card settles at the drop point. Cancel or no-op: it goes at once.
    const at = result && settleRef.current > 0 ? dropPoint(t!) : null;
    layer.current?.((s) => (at && s.card ? { card: s.card, target: null, settle: at } : EMPTY));
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      pointer.current = { x: e.clientX, y: e.clientY, buttons: e.buttons };
      // The release was lost (outside the window, or swallowed): cancel rather than follow a hover.
      if (e.buttons === 0) return void end(false);
      if (!d.lifted) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < LIFT) return;
        d.lifted = true;
        setActive(d.source);
        document.body.style.userSelect = "none";
      }
      const t = find(e.clientX, e.clientY);
      targetRef.current = t;
      layer.current?.({ card: { node: d.node, left: e.clientX - (d.sx - d.rect.left) + 6, top: e.clientY - (d.sy - d.rect.top), w: d.rect.width }, target: t, settle: null });
    };
    const up = (e: PointerEvent) => drag.current?.pointerId === e.pointerId && end(true);
    const cancel = (e: PointerEvent) => drag.current?.pointerId === e.pointerId && end(false);
    const blur = () => drag.current && end(false, true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        end(false, pointer.current.buttons !== 0);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("lostpointercapture", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
    };
  }, [find, end]);

  const start = useCallback((e: React.PointerEvent, source: DragSource, node: React.ReactNode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pressed = e.currentTarget as HTMLElement;
    const row = pressed.closest<HTMLElement>("[data-row], [data-drop-section], [data-project-item]") ?? pressed;
    drag.current = { source, sx: e.clientX, sy: e.clientY, lifted: false, node, rect: row.getBoundingClientRect(), key: source.kind === "task" ? `${source.task.project}/${source.task.no}` : undefined, pointerId: e.pointerId };
    pointer.current = { x: e.clientX, y: e.clientY, buttons: e.buttons };
    // Capture keeps pointerup / pointercancel coming to us even when released outside the window.
    try {
      pressed.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic event): the buttons check in move still cancels a lost release */
    }
  }, []);

  const value = useMemo(() => ({ start, active }), [start, active]);

  return (
    <DragCtx.Provider value={value}>
      {children}
      <DragLayer bind={layer} settleRef={settleRef} />
    </DragCtx.Provider>
  );
}

function resultOf(d: DragState, t: Target): DropResult | null {
  const s = d.source;
  if (s.kind === "task") {
    if (t.kind === "project") return t.name !== s.task.project ? { kind: "project", source: s, project: t.name } : null;
    if (t.kind === "day") return t.date !== s.task.due ? { kind: "day", source: s, date: t.date } : null;
    if (t.kind === "list" && t.list === "today") {
      const next = t.drop.kind === "between" ? t.rows[t.drop.index] : undefined;
      const beforeKey = next && next.kind === "task" ? next.key : null;
      return todayInPlace(t.rows, beforeKey, d.key!) ? null : { kind: "today", source: s, beforeKey };
    }
    if (t.kind === "list") {
      const placement = placementOf(t.rows, t.drop, d.key!);
      return placement ? { kind: "place", source: s, placement } : null;
    }
    return null;
  }
  if (t.kind !== "order") return null;
  const moving = s.name;
  const without = t.names.filter((n) => n !== moving);
  const insertAt = t.names.slice(0, t.index).filter((n) => n !== moving).length;
  without.splice(insertAt, 0, moving);
  if (without.join("\u001f") === t.names.join("\u001f")) return null;
  return s.kind === "section" ? { kind: "sections", project: s.project, names: without } : { kind: "projects", names: without };
}
