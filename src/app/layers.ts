import { useEffect, useRef } from "react";
import { isImeKey } from "./keys";

/**
 * Esc layers: everything that closes on Esc (dialog, drawer, detail panel, its popover, an inline input) registers
 * here instead of adding its own window listener. One window keydown listener calls only the topmost (most recently
 * opened) layer, so one Esc closes one thing.
 *
 * The listener is on window in the bubble phase, so an element-level handler that calls `stopPropagation` on Esc
 * (SubtaskForm) still takes precedence.
 */
type Layer = { close: () => void };
const stack: Layer[] = [];

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || isImeKey(e)) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.close();
}

/** Registers `close` as the new topmost layer. Call the returned function to remove it. */
export function pushLayer(close: () => void): () => void {
  const layer: Layer = { close };
  if (stack.length === 0) window.addEventListener("keydown", onKeyDown);
  stack.push(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener("keydown", onKeyDown);
  };
}

/** A layer that exists while `active` is true. `close` may change every render; the layer keeps its place in the stack. */
export function useEscLayer(active: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => (active ? pushLayer(() => ref.current()) : undefined), [active]);
}
