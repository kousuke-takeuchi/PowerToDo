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

/** ⌥↑ / ⌥↓ move the focused row among its siblings, Ctrl+] / Ctrl+[ indent / outdent it (spec ③ §3). JIS layouts report other `key`s, so the bracket keys match on `code` too. */
export function dragKey(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): "up" | "down" | "indent" | "outdent" | null {
  if (e.shiftKey || e.metaKey) return null;
  if (e.altKey && !e.ctrlKey) return e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
  if (e.ctrlKey && !e.altKey) {
    if (e.key === "]" || e.code === "BracketRight") return "indent";
    if (e.key === "[" || e.code === "BracketLeft") return "outdent";
  }
  return null;
}
