import { ask } from "@tauri-apps/plugin-dialog";

/**
 * Native OK / Cancel question. Use this instead of `window.confirm`: tauri-plugin-dialog replaces
 * `window.confirm` with an async function, so its return value is a Promise (always truthy) and a
 * plain `if (window.confirm(...))` would proceed without waiting for the answer.
 * Resolves `true` only when the user picks the destructive OK button.
 */
export function confirm(message: string, title?: string): Promise<boolean> {
  return ask(message, { title, kind: "warning", okLabel: "破棄して読み直す", cancelLabel: "キャンセル" });
}
