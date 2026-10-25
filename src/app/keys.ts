import type React from "react";

/**
 * True while the key event belongs to an IME (Japanese input) composition.
 *
 * `isComposing` alone is not enough: WebKit (Tauri's macOS WebView) fires `compositionend` before the keydown of
 * the Enter that commits the conversion, so that Enter arrives with `isComposing === false`. It still carries
 * `keyCode === 229`, so check both. Enter / Esc handlers that submit or close must ignore these events.
 */
export function isImeKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const n = "nativeEvent" in e ? e.nativeEvent : e;
  return n.isComposing || n.keyCode === 229;
}

/** ⌘E / Ctrl+E edits the focused row, ⌘⌫ / Ctrl+Backspace deletes it (spec ② §7). */
export function metaRowAction(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): "edit" | "remove" | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
  if (e.key.toLowerCase() === "e") return "edit";
  if (e.key === "Backspace") return "remove";
  return null;
}
