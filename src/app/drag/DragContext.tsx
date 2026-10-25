import type React from "react";
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Placement, Task } from "../../types/model";
import { autoScrollSpeed, computeDrop, placementOf, type Drop, type RowBox } from "./dropTarget";

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
type Target =
  | { kind: "list"; drop: Drop; rows: RowBox[]; list: "project" | "today" }
  | { kind: "project"; name: string; rect: DOMRect }
  | { kind: "day"; date: string; rect: DOMRect }
  | { kind: "order"; attr: "section" | "project"; names: string[]; index: number; y: number; x: number; w: number };

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

/** Spec ③ §2: lift after 4 px, a card follows the pointer, a red line (or a ring / highlight) shows the target. */
export function DragProvider({ onDrop, children }: { onDrop: (r: DropResult) => void; children: React.ReactNode }) {
  const [active, setActive] = useState<DragSource | null>(null);
  const [card, setCard] = useState<{ node: React.ReactNode; x: number; y: number; dx: number; dy: number; w: number } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const drag = useRef<{ source: DragSource; sx: number; sy: number; lifted: boolean; node: React.ReactNode; rect: DOMRect; key?: string } | null>(null);
  const targetRef = useRef<Target | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
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
      if (list && kind && (kind === d.source.view)) {
        const rows = rowBoxes(list);
        const left = list.getBoundingClientRect().left + Number(list.dataset.level0 ?? 0);
        const s = d.source;
        const dragged = kind === "today" ? { key: d.key!, depth: 0, height: 2, subtree: s.subtree } : { key: d.key!, depth: s.depth, height: s.height, subtree: s.subtree };
        const drop = computeDrop(rows, { x, y }, d.sx, dragged, left);
        return drop ? { kind: "list", drop, rows, list: kind } : null;
      }
      return null;
    }
    // Sections / projects: a line between items of the same list.
    const attr = d.source.kind === "section" ? "section" : "project";
    const listEl = document.querySelector(d.source.kind === "section" ? "[data-section-list]" : "[data-project-list]");
    if (!listEl) return null;
    const items = [...listEl.querySelectorAll<HTMLElement>(attr === "section" ? "[data-drop-section]" : "[data-project-item]")];
    const names = items.map((it) => (attr === "section" ? it.dataset.dropSection! : it.dataset.projectItem!));
    const rects = items.map((it) => it.getBoundingClientRect());
    if (!rects.length) return null;
    const lr = listEl.getBoundingClientRect();
    if (x < lr.left || x > lr.right) return null;
    let index = rects.findIndex((r) => y < (r.top + r.bottom) / 2);
    if (index < 0) index = rects.length;
    const yLine = index < rects.length ? rects[index].top : rects[rects.length - 1].bottom;
    return { kind: "order", attr, names, index, y: yLine, x: lr.left, w: lr.width };
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
          setTarget(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, find]);

  const end = useCallback((commit: boolean) => {
    const d = drag.current;
    const t = targetRef.current;
    drag.current = null;
    targetRef.current = null;
    setActive(null);
    setCard(null);
    setTarget(null);
    document.body.style.userSelect = "";
    if (!commit || !d || !d.lifted || !t) return;
    const s = d.source;
    if (s.kind === "task") {
      if (t.kind === "project") return void (t.name !== s.task.project && onDropRef.current({ kind: "project", source: s, project: t.name }));
      if (t.kind === "day") return void (t.date !== s.task.due && onDropRef.current({ kind: "day", source: s, date: t.date }));
      if (t.kind === "list" && t.list === "today") {
        const next = t.drop.kind === "between" ? t.rows[t.drop.index] : undefined;
        return void onDropRef.current({ kind: "today", source: s, beforeKey: next && next.kind === "task" ? next.key : null });
      }
      if (t.kind === "list") {
        const placement = placementOf(t.rows, t.drop, d.key!);
        if (placement) onDropRef.current({ kind: "place", source: s, placement });
      }
      return;
    }
    if (t.kind !== "order") return;
    const moving = s.name;
    const without = t.names.filter((n) => n !== moving);
    const insertAt = t.names.slice(0, t.index).filter((n) => n !== moving).length;
    without.splice(insertAt, 0, moving);
    if (without.join("\u001f") === t.names.join("\u001f")) return;
    if (s.kind === "section") onDropRef.current({ kind: "sections", project: s.project, names: without });
    else onDropRef.current({ kind: "projects", names: without });
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!d.lifted) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < LIFT) return;
        d.lifted = true;
        setActive(d.source);
        document.body.style.userSelect = "none";
      }
      setCard({ node: d.node, x: e.clientX, y: e.clientY, dx: d.sx - d.rect.left, dy: d.sy - d.rect.top, w: d.rect.width });
      const t = find(e.clientX, e.clientY);
      targetRef.current = t;
      setTarget(t);
    };
    const up = () => drag.current && end(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        end(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
    };
  }, [find, end]);

  const start = useCallback((e: React.PointerEvent, source: DragSource, node: React.ReactNode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-row], [data-drop-section], [data-project-item]") ?? (e.currentTarget as HTMLElement);
    drag.current = { source, sx: e.clientX, sy: e.clientY, lifted: false, node, rect: row.getBoundingClientRect(), key: source.kind === "task" ? `${source.task.project}/${source.task.no}` : undefined };
  }, []);

  const line = (y: number, x: number, w: number) => (
    <div style={{ position: "fixed", left: x - 4, top: y - 1, width: w, height: 2, background: "var(--color-accent)", pointerEvents: "none", zIndex: 81 }}>
      <span style={{ position: "absolute", left: 0, top: -3, width: 8, height: 8, boxSizing: "border-box", borderRadius: 4, border: "2px solid var(--color-accent)", background: "var(--color-bg)" }} />
    </div>
  );
  const ring = (r: { left: number; top: number; width: number; height: number }, fill: boolean) => (
    <div style={{ position: "fixed", left: r.left, top: r.top, width: r.width, height: r.height, borderRadius: 6, pointerEvents: "none", zIndex: 79, boxShadow: fill ? undefined : "inset 0 0 0 1px var(--color-accent)", background: fill ? "var(--color-accent-soft)" : undefined, mixBlendMode: fill ? "multiply" : undefined }} />
  );

  let indicator: React.ReactNode = null;
  if (target?.kind === "list" && target.drop.kind === "between") {
    const lr = document.querySelector(`[data-drop-list="${target.list}"]`)?.getBoundingClientRect();
    indicator = line(target.drop.y, target.drop.x, (lr?.right ?? target.drop.x + 600) - target.drop.x);
  } else if (target?.kind === "list" && target.drop.kind === "onto") {
    const el = document.querySelector<HTMLElement>(`[data-row][data-key="${CSS.escape(target.drop.key)}"]`);
    if (el) indicator = ring(el.getBoundingClientRect(), false);
  } else if (target?.kind === "project" || target?.kind === "day") {
    indicator = ring(target.rect, true);
  } else if (target?.kind === "order") {
    indicator = line(target.y, target.x + 4, target.w - 8);
  }

  return (
    <DragCtx.Provider value={{ start, active }}>
      {children}
      {active &&
        createPortal(
          <>
            {indicator}
            {card && (
              <div style={{ position: "fixed", left: card.x - card.dx + 6, top: card.y - card.dy, width: card.w, pointerEvents: "none", zIndex: 80, background: "var(--color-bg)", borderRadius: 6, boxShadow: "var(--shadow-popover)" }}>
                {card.node}
              </div>
            )}
          </>,
          document.body,
        )}
    </DragCtx.Provider>
  );
}
