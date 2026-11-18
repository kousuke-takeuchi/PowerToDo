import type React from "react";
import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { isImeKey } from "../app/keys";
import { pasteFiles, useFileDrop } from "../app/useFileDrop";
import { sameFiles } from "../app/attachments/list";
import { confirmAction } from "../api/dialogs";
import { Button } from "../components/Button";
import type { AttachmentInfo, Comment } from "../types/model";
import { AttachmentList } from "./Attachments";

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
  failed,
  autoFocusInput,
  me,
  onAdd,
  onEdit,
  onDelete,
  onAttach,
  initialPending,
  initialEditId,
}: {
  comments: Comment[];
  /** The comments could not be read (spec ① §3.6). */
  failed?: boolean;
  /** Puts the cursor in the comment input on mount. */
  autoFocusInput?: boolean;
  me?: string;
  /** Resolves true when saved (the input then clears). Without it there is no input (Storybook). The text may be empty when there are files. */
  onAdd?: (text: string, files: AttachmentInfo[]) => Promise<boolean>;
  /** `files` is given only when the attachments changed (it then replaces them). */
  onEdit?: (id: string, text: string, files?: AttachmentInfo[]) => Promise<boolean>;
  onDelete?: (id: string) => void;
  /** Stores picked, pasted or dropped files (shrunk first) and resolves the stored ones. Without it there is no clip button. */
  onAttach?: (files: File[]) => Promise<AttachmentInfo[]>;
  /** Stories: files waiting above the input. */
  initialPending?: AttachmentInfo[];
  /** Stories: this comment starts in edit mode. */
  initialEditId?: string;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AttachmentInfo[]>(initialPending ?? []);
  const [uploading, setUploading] = useState(0);
  const [editing, setEditing] = useState<{ id: string; text: string; files: AttachmentInfo[] } | null>(() => {
    const c = comments.find((x) => x.id === initialEditId);
    return c ? { id: c.id, text: c.text, files: c.files ?? [] } : null;
  });
  // Files are stored as soon as they are picked; the comment only points at them.
  const attach = (files: File[], into: "pending" | "editing") => {
    if (!onAttach || files.length === 0) return;
    setUploading((n) => n + 1);
    void onAttach(files)
      .then((stored) => {
        if (into === "pending") setPending((cur) => [...cur, ...stored]);
        else setEditing((cur) => (cur ? { ...cur, files: [...cur.files, ...stored] } : cur));
      })
      .finally(() => setUploading((n) => n - 1));
  };
  const send = () => {
    const text = draft.trim();
    if ((!text && pending.length === 0) || !onAdd || uploading > 0) return;
    void onAdd(text, pending).then((ok) => {
      if (!ok) return;
      setDraft("");
      setPending([]);
    });
  };
  const saveEdit = () => {
    if (!editing || !onEdit || uploading > 0) return;
    const text = editing.text.trim();
    if (!text && editing.files.length === 0) return;
    const before = comments.find((c) => c.id === editing.id)?.files ?? [];
    void onEdit(editing.id, text, sameFiles(before, editing.files) ? undefined : editing.files).then((ok) => ok && setEditing(null));
  };
  const composerDrop = useFileDrop((files) => attach(files, "pending"));
  const editDrop = useFileDrop((files) => attach(files, "editing"));
  const picker = useRef<HTMLInputElement>(null);
  const editPicker = useRef<HTMLInputElement>(null);
  const pickInput = (ref: React.RefObject<HTMLInputElement | null>, into: "pending" | "editing") => (
    <input
      ref={ref}
      type="file"
      multiple
      hidden
      aria-label="ファイルを選ぶ"
      onChange={(e) => {
        attach(Array.from(e.target.files ?? []), into);
        e.target.value = "";
      }}
    />
  );
  if (comments.length === 0 && !onAdd) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={heading}>コメント</div>
      {failed && <div style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-danger)" }}>コメントを読み込めませんでした</div>}
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
                    <button type="button" style={linkButton} onClick={() => setEditing({ id: c.id, text: c.text, files: c.files ?? [] })}>
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
                <div {...editDrop.props} style={{ display: "flex", flexDirection: "column", gap: 4, outline: editDrop.over ? "2px dashed var(--color-accent)" : undefined, outlineOffset: 2, borderRadius: 8 }}>
                  <AttachmentList files={editing.files} alwaysRemove onRemove={(i) => setEditing({ ...editing, files: editing.files.filter((_, j) => j !== i) })} />
                  <textarea
                    aria-label="コメントを編集"
                    autoFocus
                    rows={2}
                    value={editing.text}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    onPaste={(e) => pasteFiles(e, (f) => attach(f, "editing"))}
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
                    {onAttach && (
                      <>
                        {pickInput(editPicker, "editing")}
                        <button type="button" style={linkButton} onClick={() => editPicker.current?.click()}>
                          添付
                        </button>
                      </>
                    )}
                    <button type="button" style={linkButton} onClick={() => setEditing(null)}>
                      キャンセル
                    </button>
                    <button type="button" style={{ ...linkButton, color: "var(--color-accent)", fontWeight: 600 }} onClick={saveEdit}>
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {c.text && <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</span>}
                  <AttachmentList files={c.files ?? []} />
                </>
              )}
            </div>
          </div>
        );
      })}
      {onAdd && (
        <div
          {...composerDrop.props}
          data-drop-zone="composer"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", outline: composerDrop.over ? "2px dashed var(--color-accent)" : undefined, outlineOffset: 2, borderRadius: 8 }}
        >
          <AttachmentList files={pending} alwaysRemove onRemove={(i) => setPending((cur) => cur.filter((_, j) => j !== i))} />
          <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "flex-end" }}>
            <textarea
              aria-label="コメント"
              autoFocus={autoFocusInput}
              placeholder="コメント"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => pasteFiles(e, (f) => attach(f, "pending"))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isImeKey(e)) {
                  e.preventDefault();
                  send();
                }
              }}
              style={{ ...field, flex: 1, minWidth: 0 }}
            />
            {onAttach && (
              <>
                {pickInput(picker, "pending")}
                <Button variant="icon" icon={Paperclip} ariaLabel="ファイルを添付" onClick={() => picker.current?.click()} />
              </>
            )}
          </div>
          {uploading > 0 && <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>添付を準備しています…</span>}
        </div>
      )}
    </div>
  );
}
