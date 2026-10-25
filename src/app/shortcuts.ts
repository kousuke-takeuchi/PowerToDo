import { useEffect, useRef } from "react";
import { dragKey, isImeKey, metaRowAction } from "./keys";

/** True while typing: an INPUT / TEXTAREA / SELECT / contentEditable has focus, or the key belongs to an IME composition. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  if (isImeKey(e)) return true;
  const t = e.target instanceof HTMLElement ? e.target : null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

const INTERACTIVE =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]';

/** A focused control (not the page body) that uses Enter / Space / Delete / Backspace itself. */
function isInteractiveTarget(e: KeyboardEvent): boolean {
  const t = e.target instanceof HTMLElement ? e.target : null;
  return !!t && t !== document.body && t.matches(INTERACTIVE);
}

export type RowHandlers = {
  /** True while a row has the keyboard focus. The keys that act on the focused row (and Enter / Backspace, which a focused button also uses) are left alone while it is false. */
  hasFocus: boolean;
  up: () => void;
  down: () => void;
  open: () => void;
  toggleDone: () => void;
  remove: () => void;
  /** ⌘E (spec ② §7). */
  edit?: () => void;
  setPriority: (p: 1 | 2 | 3 | 4) => void;
  dueToday: () => void;
  dueTomorrow: () => void;
  expand: () => void;
  collapse: () => void;
  clear: () => void;
  /** ⌥↑ / ⌥↓ / Ctrl+] / Ctrl+[ on the focused row (spec ③ §7). */
  moveKey?: (k: "up" | "down" | "indent" | "outdent") => void;
};

export type ShortcutHandlers = {
  quickAdd: () => void;
  search: () => void;
  goToday: () => void;
  goUpcoming: () => void;
  goInbox: () => void;
  goLabels: () => void;
  /** null while no list is on screen. */
  row: RowHandlers | null;
  /** false while a dialog is open (its own keys win). */
  enabled: boolean;
};

const G_TIMEOUT_MS = 1000;

/** One window keydown listener for every shortcut in 仕様 §6. Handlers may change every render. */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const gAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (isImeKey(e)) return;
        e.preventDefault();
        if (h.enabled) h.search();
        return;
      }
      const moveAct = dragKey(e);
      if (moveAct && !e.defaultPrevented && h.enabled && !isTypingTarget(e) && h.row?.hasFocus && h.row.moveKey) {
        e.preventDefault();
        if (!e.repeat) h.row.moveKey(moveAct);
        return;
      }
      const metaAct = metaRowAction(e);
      if (metaAct && !e.defaultPrevented && h.enabled && !isTypingTarget(e) && h.row?.hasFocus) {
        e.preventDefault();
        if (metaAct === "edit") h.row.edit?.();
        else h.row.remove();
        return;
      }
      // an element-level handler (a menu, a tab list) already took this key
      if (e.defaultPrevented || !h.enabled || isTypingTarget(e) || meta || e.altKey) return;
      const key = e.key;
      // only Cmd/Ctrl+K carries a modifier; arrows may
      if (e.shiftKey && !key.startsWith("Arrow")) return;
      // a focused button / link / menu item keeps Enter, Space, Delete and Backspace for itself
      if (isInteractiveTarget(e) && (key === "Enter" || key === " " || key === "Delete" || key === "Backspace")) return;
      const now = Date.now();
      if (now - gAt.current < G_TIMEOUT_MS) {
        gAt.current = 0;
        const go = { t: h.goToday, u: h.goUpcoming, i: h.goInbox, l: h.goLabels }[key.toLowerCase()];
        if (go) {
          e.preventDefault();
          go();
          return;
        }
      }
      const r = h.row;
      const f = r?.hasFocus ? r : null;
      const act: Record<string, (() => void) | undefined> = {
        q: h.quickAdd,
        "/": h.search,
        g: () => {
          gAt.current = now;
        },
        ArrowUp: r?.up,
        ArrowDown: r?.down,
        Enter: f?.open,
        e: f?.toggleDone,
        Delete: f?.remove,
        Backspace: f?.remove,
        "1": f ? () => f.setPriority(1) : undefined,
        "2": f ? () => f.setPriority(2) : undefined,
        "3": f ? () => f.setPriority(3) : undefined,
        "4": f ? () => f.setPriority(4) : undefined,
        t: f?.dueToday,
        m: f?.dueTomorrow,
        ArrowRight: f?.expand,
        ArrowLeft: f?.collapse,
      };
      const own = (k: string) => (Object.prototype.hasOwnProperty.call(act, k) ? act[k] : undefined);
      const fn = own(key) ?? own(key.toLowerCase());
      if (!fn) return;
      e.preventDefault();
      // 押しっぱなしの自動リピートで、完了の切り替えや削除を繰り返さない
      if (e.repeat && (key.toLowerCase() === "e" || key === "Delete" || key === "Backspace")) return;
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
