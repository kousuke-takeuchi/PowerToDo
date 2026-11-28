import { useRef, useState } from "react";
import { File as FileIcon, FileText, Image as ImageIcon, Plus } from "lucide-react";
import { formatBytes } from "../app/attachments/list";
import type { AttachmentInfo } from "../types/model";

function iconOf(f: AttachmentInfo) {
  if (f.type.startsWith("image/")) return ImageIcon;
  if (f.type.startsWith("text/") || f.type === "application/pdf") return FileText;
  return FileIcon;
}

/** The 参考資料 box of a document: files kept beside the text. The parent stores them and saves `files` at once. */
export function ReferenceFiles({
  files,
  onAdd,
  onOpen,
  onRemove,
  mobile,
}: {
  files: AttachmentInfo[];
  onAdd: (files: File[]) => void;
  onOpen: (f: AttachmentInfo) => void;
  onRemove: (f: AttachmentInfo) => void;
  mobile?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const key = (f: AttachmentInfo) => `${f.hash}.${f.ext}`;
  const row = mobile ? 44 : 32;
  return (
    <section
      aria-label="参考資料"
      onDragOver={
        mobile
          ? undefined
          : (e) => {
              e.preventDefault();
              setOver(true);
            }
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        mobile
          ? undefined
          : (e) => {
              e.preventDefault();
              setOver(false);
              const dropped = Array.from(e.dataTransfer.files);
              if (dropped.length) onAdd(dropped);
            }
      }
      style={{ display: "flex", flexDirection: "column", gap: 4, padding: 12, border: `1px solid ${over ? "var(--color-accent)" : "var(--color-border)"}`, borderRadius: 8, background: over ? "var(--color-drop-highlight)" : "var(--color-bg)", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-text-primary)" }}
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
        参考資料 <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{files.length}</span>
      </h3>
      {files.map((f) => {
        const Icon = iconOf(f);
        return (
          <div key={key(f)} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, minHeight: row }}>
            <button
              type="button"
              title={`${f.name} を開く`}
              onClick={() => onOpen(f)}
              style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, minHeight: row, padding: 0, border: 0, background: "none", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
            >
              <Icon size={16} aria-hidden color="var(--color-text-muted)" style={{ flex: "0 0 auto" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span style={{ flex: "0 0 auto", fontSize: 12, color: "var(--color-text-muted)" }}>{formatBytes(f.size)}</span>
            </button>
            <button
              type="button"
              aria-label={`${f.name} のその他の操作`}
              onClick={() => setMenu(menu === key(f) ? null : key(f))}
              style={{ flex: "0 0 auto", minWidth: row - 8, minHeight: row - 8, border: 0, background: "none", color: "var(--color-text-secondary)", cursor: "pointer", font: "inherit" }}
            >
              …
            </button>
            {menu === key(f) && (
              <div role="menu" style={{ position: "absolute", right: 0, top: "100%", zIndex: 10, minWidth: 100, padding: "4px 0", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "var(--shadow-popover)" }}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    onRemove(f);
                  }}
                  style={{ display: "block", width: "100%", minHeight: row, padding: "0 12px", border: 0, background: "none", font: "inherit", color: "var(--color-danger)", textAlign: "left", cursor: "pointer" }}
                >
                  外す
                </button>
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => input.current?.click()}
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4, minHeight: row, padding: 0, border: 0, background: "none", font: "inherit", color: "var(--color-accent)", cursor: "pointer" }}
      >
        <Plus size={14} aria-hidden />
        ファイルを追加
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length) onAdd(picked);
        }}
      />
    </section>
  );
}
