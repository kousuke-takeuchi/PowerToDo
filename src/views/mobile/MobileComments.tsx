import type React from "react";
import { useRef, useState } from "react";
import { Ellipsis, Paperclip, Send } from "lucide-react";
import { confirmAction } from "../../api/dialogs";
import { sameFiles } from "../../app/attachments/list";
import type { AttachmentInfo, Comment } from "../../types/model";
import { AttachmentList } from "../Attachments";
import { commentTime } from "../CommentsSection";
import { SheetCard } from "./BottomSheet";

/** What the iPhone's file input offers: Photo Library, Take Photo and Choose File (iOS shows all three). Not listing .heic lets iOS convert photos to JPEG itself. */
export const PICK_ACCEPT = "image/*,application/*,text/*";

const textStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: "10px 16px",
  border: 0,
  outline: "none",
  background: "transparent",
  fontFamily: "var(--font-body)",
  fontSize: 16, // 16 px: iOS does not zoom the page on focus
  lineHeight: "22px",
  color: "var(--color-text-primary)",
  resize: "none",
};
const textButton: React.CSSProperties = { minHeight: 44, padding: "0 8px", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", color: "var(--color-text-secondary)", cursor: "pointer" };
const round: React.CSSProperties = { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, border: 0, borderRadius: 22, cursor: "pointer", flex: "0 0 auto" };

/**
 * The body of the iPhone comment sheet (spec attachments §6; Todoist iPhone research): the comments of the task, oldest
 * first (name, time, text, pictures and file chips, 「…」 on your own), and an input card pinned to the bottom with the
 * clip (Photo Library / Take Photo / Choose File) and a round send button. Put it in a large BottomSheet.
 */
export function MobileComments({
  comments,
  failed,
  me,
  taskTitle,
  onAdd,
  onEdit,
  onDelete,
  onAttach,
  initialPending,
  initialEditId,
  autoFocus,
}: {
  comments: Comment[];
  failed?: boolean;
  me?: string;
  taskTitle?: string;
  /** Resolves true when saved (the input then clears). The text may be empty when there are files. */
  onAdd?: (text: string, files: AttachmentInfo[]) => Promise<boolean>;
  onEdit?: (id: string, text: string, files?: AttachmentInfo[]) => Promise<boolean>;
  onDelete?: (id: string) => void;
  /** Stores picked files (shrunk first) and resolves the stored ones. Without it there is no clip. */
  onAttach?: (files: File[]) => Promise<AttachmentInfo[]>;
  /** Stories: files waiting in the input. */
  initialPending?: AttachmentInfo[];
  /** Stories: this comment starts in edit mode. */
  initialEditId?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AttachmentInfo[]>(initialPending ?? []);
  const [uploading, setUploading] = useState(0);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; files: AttachmentInfo[] } | null>(() => {
    const c = comments.find((x) => x.id === initialEditId);
    return c ? { id: c.id, text: c.text, files: c.files ?? [] } : null;
  });
  const picker = useRef<HTMLInputElement>(null);
  const editPicker = useRef<HTMLInputElement>(null);
  // Files are stored as soon as they are picked; the comment only points at them. An edit's files go to the comment
  // that was being edited when they were picked.
  const attach = (files: File[], into: "pending" | "editing") => {
    if (!onAttach || files.length === 0) return;
    const editId = editing?.id;
    setUploading((n) => n + 1);
    void onAttach(files)
      .then((stored) => {
        if (into === "pending") setPending((cur) => [...cur, ...stored]);
        else setEditing((cur) => (cur && cur.id === editId ? { ...cur, files: [...cur.files, ...stored] } : cur));
      })
      .finally(() => setUploading((n) => n - 1));
  };
  // One send at a time; files picked while it is being saved stay for the next comment.
  const sending = useRef(false);
  const canSend = (draft.trim() !== "" || pending.length > 0) && uploading === 0;
  const send = () => {
    const text = draft.trim();
    if ((!text && pending.length === 0) || !onAdd || uploading > 0 || sending.current) return;
    const sent = pending;
    sending.current = true;
    void onAdd(text, sent)
      .then((ok) => {
        if (!ok) return;
        setDraft("");
        setPending((cur) => cur.filter((f) => !sent.includes(f)));
      })
      .finally(() => {
        sending.current = false;
      });
  };
  const saveEdit = () => {
    if (!editing || !onEdit || uploading > 0) return;
    const text = editing.text.trim();
    if (!text && editing.files.length === 0) return;
    const before = comments.find((c) => c.id === editing.id)?.files ?? [];
    void onEdit(editing.id, text, sameFiles(before, editing.files) ? undefined : editing.files).then((ok) => ok && setEditing(null));
  };
  const pickInput = (ref: React.RefObject<HTMLInputElement | null>, into: "pending" | "editing") => (
    <input
      ref={ref}
      type="file"
      multiple
      hidden
      accept={PICK_ACCEPT}
      aria-label="ファイルを選ぶ"
      onChange={(e) => {
        attach(Array.from(e.target.files ?? []), into);
        e.target.value = "";
      }}
    />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 auto", minHeight: 0 }}>
      {taskTitle && <div style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)", textAlign: "center", overflowWrap: "anywhere" }}>{taskTitle}</div>}
      {failed && (
        <div role="alert" style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-danger)" }}>
          コメントを読み込めませんでした
        </div>
      )}
      {comments.length === 0 && !failed && <div style={{ padding: "16px 0", textAlign: "center", fontSize: 14, color: "var(--color-text-muted)" }}>コメントはまだありません</div>}
      {comments.length > 0 && (
        <SheetCard label="コメント">
          {comments.map((c) => {
            const mine = me !== undefined && c.author === me && !!onEdit && !!onDelete;
            const isEditing = editing?.id === c.id;
            return (
              <div key={c.id} data-comment="" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px", boxShadow: "inset 0 -0.5px 0 var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24 }}>
                  <span aria-hidden style={{ width: 24, height: 24, borderRadius: 12, background: "var(--color-accent)", flex: "0 0 auto" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)" }}>
                    <b style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{c.author}</b>
                    {`  ${commentTime(c.at)}${c.edited ? " (編集済み)" : ""}`}
                  </span>
                  {mine && !isEditing && (
                    <button type="button" aria-label="コメントのその他の操作" aria-expanded={menuId === c.id} onClick={() => setMenuId(menuId === c.id ? null : c.id)} style={{ ...round, width: 36, height: 36, margin: "-6px -8px -6px 0", background: "none", color: "var(--color-text-secondary)" }}>
                      <Ellipsis size={18} />
                    </button>
                  )}
                </div>
                {menuId === c.id && !isEditing && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      style={textButton}
                      onClick={() => {
                        setMenuId(null);
                        setEditing({ id: c.id, text: c.text, files: c.files ?? [] });
                      }}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      style={{ ...textButton, color: "var(--color-danger)" }}
                      onClick={() => {
                        setMenuId(null);
                        void confirmAction("このコメントを削除します。", { title: "コメントの削除", okLabel: "削除" })
                          .then((ok) => ok && onDelete?.(c.id))
                          .catch(() => undefined);
                      }}
                    >
                      削除
                    </button>
                  </div>
                )}
                {isEditing && editing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <AttachmentList touch files={editing.files} alwaysRemove onRemove={(i) => setEditing({ ...editing, files: editing.files.filter((_, j) => j !== i) })} />
                    <textarea
                      aria-label="コメントを編集"
                      autoFocus
                      rows={3}
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      style={{ ...textStyle, padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}
                    />
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {onAttach && (
                        <>
                          {pickInput(editPicker, "editing")}
                          <button type="button" style={textButton} onClick={() => editPicker.current?.click()}>
                            添付
                          </button>
                        </>
                      )}
                      <span style={{ flex: 1 }} />
                      <button type="button" style={textButton} onClick={() => setEditing(null)}>
                        キャンセル
                      </button>
                      <button type="button" style={{ ...textButton, color: "var(--color-accent)", fontWeight: 600 }} onClick={saveEdit}>
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {c.text && <div style={{ fontSize: 16, lineHeight: "22px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text}</div>}
                    <AttachmentList touch files={c.files ?? []} />
                  </>
                )}
              </div>
            );
          })}
        </SheetCard>
      )}
      {onAdd && (
        // Pinned at the bottom of the sheet's scroll area, above the keyboard (the sheet itself lifts by its height).
        <div style={{ position: "sticky", bottom: 0, marginTop: "auto", paddingTop: 4, background: "var(--color-sheet-bg)" }}>
          <SheetCard label="コメントを書く">
            {pending.length > 0 && (
              <div style={{ padding: "12px 16px 0" }}>
                <AttachmentList touch files={pending} alwaysRemove onRemove={(i) => setPending((cur) => cur.filter((_, j) => j !== i))} />
              </div>
            )}
            <textarea aria-label="コメント" autoFocus={autoFocus} placeholder="コメント" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} style={textStyle} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 8px 8px" }}>
              {onAttach && (
                <>
                  {pickInput(picker, "pending")}
                  <button type="button" aria-label="ファイルを添付" onClick={() => picker.current?.click()} style={{ ...round, background: "none", color: "var(--color-text-secondary)" }}>
                    <Paperclip size={20} />
                  </button>
                </>
              )}
              <span style={{ flex: 1, fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{uploading > 0 ? "添付を準備しています…" : ""}</span>
              <button
                type="button"
                aria-label="送信"
                disabled={!canSend}
                onClick={send}
                style={{ ...round, background: "var(--color-accent)", color: "#FFFFFF" /* white on accent */, opacity: canSend ? 1 : 0.4, cursor: canSend ? "pointer" : "default" }}
              >
                <Send size={18} />
              </button>
            </div>
          </SheetCard>
        </div>
      )}
    </div>
  );
}
