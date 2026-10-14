import { ask } from "@tauri-apps/plugin-dialog";

/*
 * Native OK / Cancel questions. Use these instead of `window.confirm`: tauri-plugin-dialog replaces
 * `window.confirm` with an async function, so its return value is a Promise (always truthy) and a
 * plain `if (window.confirm(...))` would proceed without waiting for the answer.
 * Both resolve `true` only when the user picks the OK button.
 */

/** 未保存の変更を捨てて読み直す確認。ラベルはこの用途に固定 (別の確認には confirmAction を使う)。 */
export function confirmDiscard(message: string, title?: string): Promise<boolean> {
  return ask(message, { title, kind: "warning", okLabel: "破棄して読み直す", cancelLabel: "キャンセル" });
}

export type ConfirmActionOptions = { title?: string; okLabel: string; cancelLabel?: string };

/** 任意の操作の確認。`okLabel` は必須 (押すと何が起きるかを書く)。 */
export function confirmAction(message: string, { title, okLabel, cancelLabel = "キャンセル" }: ConfirmActionOptions): Promise<boolean> {
  return ask(message, { title, kind: "warning", okLabel, cancelLabel });
}
