import { useEffect, useRef } from "react";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { deleteMessage, enterConfirms } from "./deleteMessage";

/** Spec ② §4.3: the one delete confirmation (row menu, keys, task dialog). Enter deletes, Esc cancels. */
export function DeleteTaskDialog({ title, subtasks, onCancel, onConfirm }: { title: string; subtasks: number; onCancel: () => void; onConfirm: () => void }) {
  useEscLayer(true, onCancel);
  // Enter deletes wherever the focus is (the menu item that opened this may still hold it), except on キャンセル
  // or another button, and once (not on auto-repeat). The 削除 button takes the focus once drawn.
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const del = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => del.current?.querySelector("button")?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      const onOther = a instanceof HTMLButtonElement && !del.current?.contains(a);
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (enterConfirms(e, onOther)) confirm.current();
      else if (onOther && !e.repeat && a instanceof HTMLButtonElement) a.click();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-label="タスクの削除"
        tabIndex={-1}
        style={{
          width: 384,
          boxSizing: "border-box",
          padding: "20px 16px 16px",
          borderRadius: 10,
          background: "var(--color-bg)",
          boxShadow: "var(--shadow-dialog)",
          fontFamily: "var(--font-body)",
          outline: "none",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px", color: "var(--color-text-primary)" }}>タスクを削除しますか?</div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{deleteMessage(title, subtasks)}</div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <div ref={del} style={{ display: "contents" }}>
            <Button onClick={onConfirm}>削除</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
