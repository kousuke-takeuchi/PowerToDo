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
/** Called on Esc when no layer is open (clears the keyboard row focus). See `setEscFallback`. */
let fallback: (() => void) | null = null;
let listening = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || isImeKey(e)) return;
  const top = stack[stack.length - 1];
  if (!top) {
    fallback?.();
    return;
  }
  e.preventDefault();
  top.close();
}

/** The listener is registered while there is a layer or a fallback. */
function syncListener() {
  const want = stack.length > 0 || fallback !== null;
  if (want && !listening) window.addEventListener("keydown", onKeyDown);
  else if (!want && listening) window.removeEventListener("keydown", onKeyDown);
  listening = want;
}

/** Sets what Esc does when no layer is open (`null` removes it). */
export function setEscFallback(fn: (() => void) | null): void {
  fallback = fn;
  syncListener();
}

/** Registers `close` as the new topmost layer. Call the returned function to remove it. */
export function pushLayer(close: () => void): () => void {
  const layer: Layer = { close };
  stack.push(layer);
  syncListener();
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    syncListener();
  };
}

/** A layer that exists while `active` is true. `close` may change every render; the layer keeps its place in the stack. */
export function useEscLayer(active: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => (active ? pushLayer(() => ref.current()) : undefined), [active]);
}
