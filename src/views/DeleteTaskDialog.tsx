import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { deleteMessage } from "./deleteMessage";

/** Spec ② §4.3: the one delete confirmation (row menu, keys, task dialog). Enter deletes, Esc cancels. */
export function DeleteTaskDialog({ title, subtasks, onCancel, onConfirm }: { title: string; subtasks: number; onCancel: () => void; onConfirm: () => void }) {
  useEscLayer(true, onCancel);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-label="タスクの削除"
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onConfirm();
          }
        }}
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
          <Button onClick={onConfirm}>削除</Button>
        </div>
      </div>
    </div>
  );
}
