import type React from "react";
import { useState } from "react";
import { isImeKey } from "../app/keys";
import { confirmAction } from "../api/dialogs";
import type { Comment } from "../types/model";

const heading: React.CSSProperties = { fontSize: 13, lineHeight: "19px", fontWeight: 700, color: "var(--color-text-primary)" };
const field: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-bg)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  resize: "vertical",
  outline: "none",
};
const linkButton: React.CSSProperties = {
  padding: 0,
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  lineHeight: "17px",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

/** 「10月25日 21:04」 (local time). The text as it is when it does not read as a date. */
export function commentTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * Spec ① §3.3: the comments of a task, oldest first, and an input. Enter sends, Shift+Enter is a new
 * line, Enter while composing (IME) does nothing. Only `me`'s comments show 編集 / 削除 (on hover).
 */
export function CommentsSection({
  comments,
  me,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: Comment[];
  me?: string;
  /** Resolves true when saved (the input then clears). Without it there is no input (Storybook). */
  onAdd?: (text: string) => Promise<boolean>;
  onEdit?: (id: string, text: string) => Promise<boolean>;
  onDelete?: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const send = () => {
    const text = draft.trim();
    if (!text || !onAdd) return;
    void onAdd(text).then((ok) => ok && setDraft(""));
  };
  const saveEdit = () => {
    if (!editing || !onEdit) return;
    const text = editing.text.trim();
    if (!text) return;
    void onEdit(editing.id, text).then((ok) => ok && setEditing(null));
  };
  if (comments.length === 0 && !onAdd) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={heading}>コメント</div>
      {comments.map((c) => {
        const mine = me !== undefined && c.author === me;
        return (
          <div key={c.id} className="group" style={{ display: "flex", gap: "var(--space-2)" }}>
            <span aria-hidden style={{ width: 24, height: 24, borderRadius: 12, background: "var(--color-accent)", flex: "0 0 auto" }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>
                  {`${c.author}  ${commentTime(c.at)}${c.edited ? " (編集済み)" : ""}`}
                </span>
                {mine && onEdit && onDelete && editing?.id !== c.id && (
                  <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" style={{ display: "inline-flex", gap: "var(--space-2)" }}>
                    <button type="button" style={linkButton} onClick={() => setEditing({ id: c.id, text: c.text })}>
                      編集
                    </button>
                    <button
                      type="button"
                      style={{ ...linkButton, color: "var(--color-danger)" }}
                      onClick={() =>
                        void confirmAction("このコメントを削除します。", { title: "コメントの削除", okLabel: "削除" })
                          .then((ok) => ok && onDelete(c.id))
                          .catch(() => undefined)
                      }
                    >
                      削除
                    </button>
                  </span>
                )}
              </div>
              {editing?.id === c.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <textarea
                    aria-label="コメントを編集"
                    autoFocus
                    rows={2}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !isImeKey(e)) {
                        e.preventDefault();
                        saveEdit();
                      } else if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    style={field}
                  />
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button type="button" style={linkButton} onClick={() => setEditing(null)}>
                      キャンセル
                    </button>
                    <button type="button" style={{ ...linkButton, color: "var(--color-accent)", fontWeight: 600 }} onClick={saveEdit}>
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</span>
              )}
            </div>
          </div>
        );
      })}
      {onAdd && (
        <textarea
          aria-label="コメント"
          placeholder="コメント"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isImeKey(e)) {
              e.preventDefault();
              send();
            }
          }}
          style={field}
        />
      )}
    </div>
  );
}
