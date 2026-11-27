import { useEffect, useLayoutEffect, useRef } from "react";
import { wheelIndex } from "../app/wheel";
import { minuteChoices, timeOf } from "../app/timeChoices";

const ITEM = 44;
const ROWS = 5;

/**
 * One column of the wheel: a scroll-snapping list; the row at the middle is the value, and it follows the scroll live (as iOS's wheels do).
 * The list is moved only when the value changed from outside (the row at the middle is not `index`), so a scroll is never fought.
 */
function Column({ items, index, onPick, label }: { items: string[]; index: number; onPick: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // At first the list is put on the value before it is painted.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = index * ITEM;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && wheelIndex(el.scrollTop, ITEM, items.length) !== index) el.scrollTo({ top: index * ITEM });
  }, [index, items.length]);
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={(e) => {
        const i = wheelIndex(e.currentTarget.scrollTop, ITEM, items.length);
        if (i !== index) onPick(i);
      }}
      style={{ position: "relative", zIndex: 1, flex: 1, height: ITEM * ROWS, overflowY: "auto", scrollSnapType: "y mandatory", scrollbarWidth: "none", overscrollBehavior: "contain", touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
    >
      <div style={{ height: ITEM * 2 }} aria-hidden />
      {items.map((t, i) => (
        <div key={t} role="option" aria-selected={i === index} style={{ height: ITEM, display: "grid", placeItems: "center", scrollSnapAlign: "center", fontFamily: "var(--font-body)", fontSize: 22, color: i === index ? "var(--color-text-primary)" : "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {t}
        </div>
      ))}
      <div style={{ height: ITEM * 2 }} aria-hidden />
    </div>
  );
}

/**
 * A time of day as a drum roll (spec 2026-11-28): an hour wheel and a minute wheel (every 5 minutes), as the iPhone's own picker looks,
 * with the chosen row in the band at the middle. A minute that is not a multiple of 5 (typed in the date field) stays on the wheel.
 */
export function TimeWheel({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  const minutes = minuteChoices(minute);
  // The latest value, so two wheels settling close together do not undo each other (each pick starts from the other's new value).
  const latest = useRef({ hour, minute });
  latest.current = { hour, minute };
  const emit = (h: number, m: number) => {
    latest.current = { hour: h, minute: m };
    onChange(timeOf(h, m));
  };
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", padding: "0 24px" }}>
      {/* the band the chosen row sits in, and the fade of the rows above and below */}
      <div aria-hidden style={{ position: "absolute", left: 12, right: 12, top: ITEM * 2, height: ITEM, borderRadius: 10, background: "var(--color-bg-hover)", pointerEvents: "none" }} />
      <Column label="時" items={Array.from({ length: 24 }, (_, h) => String(h))} index={hour} onPick={(i) => emit(i, latest.current.minute)} />
      <span aria-hidden style={{ fontSize: 22, color: "var(--color-text-primary)", zIndex: 1 }}>:</span>
      <Column label="分" items={minutes.map((m) => String(m).padStart(2, "0"))} index={Math.max(0, minutes.indexOf(minute))} onPick={(i) => emit(latest.current.hour, minutes[i])} />
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: "linear-gradient(to bottom, var(--color-sheet-card) 0%, transparent 35%, transparent 65%, var(--color-sheet-card) 100%)" }} />
    </div>
  );
}
