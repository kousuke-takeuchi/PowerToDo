import type React from "react";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Ellipsis, FolderOpen, Paperclip, X } from "lucide-react";
import { useEscLayer } from "../app/layers";
import { AttachmentEnvContext } from "../app/attachments/env";
import { Picture } from "./AttachmentPicture";
import { MobileAttachmentViewer } from "./mobile/MobileAttachmentViewer";
import { buildAttachmentList, formatBytes, stepViewer } from "../app/attachments/list";
import type { AttachmentInfo } from "../types/model";

function useEnvAction() {
  const env = useContext(AttachmentEnvContext);
  return (run: () => Promise<void>) => void run().catch(env.onError);
}

const removeStyle: React.CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  width: 18,
  height: 18,
  padding: 0,
  border: 0,
  borderRadius: 9,
  background: "var(--color-text-primary)",
  color: "var(--color-bg)",
  cursor: "pointer",
};

/** 「Finder で表示」「別名で保存」 at the pointer (right-click, or the … button). Closes on a click outside, Esc and blur. */
function FileMenu({ file, at, onClose }: { file: AttachmentInfo; at: { x: number; y: number }; onClose: () => void }) {
  const env = useContext(AttachmentEnvContext);
  const act = useEnvAction();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useEscLayer(true, onClose);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
  }, [at]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", down, true);
    return () => window.removeEventListener("mousedown", down, true);
  }, [onClose]);
  const item = (label: string, run: () => Promise<void>) => (
    <button
      type="button"
      role="menuitem"
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      onClick={() => {
        onClose();
        act(run);
      }}
      style={{ display: "block", width: "100%", padding: "6px 12px", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", textAlign: "left", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      {label}
    </button>
  );
  return createPortal(
    <div ref={ref} role="menu" aria-label="ファイルの操作" style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 1100, minWidth: 140, padding: "4px 0", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "var(--shadow-popover)" }}>
      {item("Finder で表示", () => env.reveal(file))}
      {item("別名で保存", () => env.saveAs(file))}
    </div>,
    document.body,
  );
}

function Chip({ file, sizeText, onRemove, alwaysRemove, touch }: { file: AttachmentInfo; sizeText: string; onRemove?: () => void; alwaysRemove?: boolean; touch?: boolean }) {
  const env = useContext(AttachmentEnvContext);
  const act = useEnvAction();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="group"
      onContextMenu={
        touch
          ? undefined
          : (e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }
      }
      style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", padding: touch ? "0 8px 0 10px" : "4px 6px 4px 8px", minHeight: touch ? 44 : undefined, boxSizing: "border-box", border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-bg)", fontFamily: "var(--font-body)", fontSize: 12, lineHeight: "17px", color: "var(--color-text-primary)" }}
    >
      <Paperclip size={12} aria-hidden color="var(--color-text-muted)" style={{ flex: "0 0 auto" }} />
      <button
        type="button"
        title={`${file.name} を開く`}
        onClick={() => act(() => env.open(file))}
        style={{ minWidth: 0, display: "inline-flex", gap: 6, alignItems: touch ? "center" : "baseline", padding: 0, border: 0, background: "none", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left", minHeight: touch ? 44 : undefined, alignSelf: touch ? "center" : undefined }}
      >
        <span style={{ minWidth: 0, maxWidth: touch ? 220 : 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
        <span style={{ flex: "0 0 auto", color: "var(--color-text-muted)" }}>{sizeText}</span>
      </button>
      {!touch && (
      <button
        type="button"
        aria-label={`${file.name} のその他の操作`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 2 });
        }}
        style={{ display: "inline-flex", padding: 0, border: 0, background: "none", color: "var(--color-text-secondary)", cursor: "pointer" }}
      >
        <Ellipsis size={14} />
      </button>
      )}
      {onRemove && (
        <button type="button" aria-label={`${file.name} を外す`} className={alwaysRemove || touch ? undefined : "opacity-0 group-hover:opacity-100 focus:opacity-100"} onClick={onRemove} style={touch ? { ...removeStyle, width: 28, height: 28, borderRadius: 14 } : removeStyle}>
          <X size={touch ? 14 : 12} />
        </button>
      )}
      {menu && <FileMenu file={file} at={menu} onClose={() => setMenu(null)} />}
    </span>
  );
}

/**
 * Spec attachments §5: the files of a comment or a description. Pictures are thumbnails (click: the viewer, among
 * the pictures of this list); other files are chips. `onRemove` (by index) shows a × (on hover, or always).
 */
export function AttachmentList({
  files,
  ids,
  onRemove,
  alwaysRemove,
  touch,
}: {
  files: AttachmentInfo[];
  /** Keys for the files (the description's `note-attach` ids). */
  ids?: string[];
  onRemove?: (index: number) => void;
  alwaysRemove?: boolean;
  /** iPhone (spec attachments §6): the touch viewer, 44 px chips, a × that is always there, no right-click menu. */
  touch?: boolean;
}) {
  const { items, images } = buildAttachmentList(files, ids);
  const [viewing, setViewing] = useState<number | null>(null);
  if (items.length === 0) return null;
  const Viewer = touch ? MobileAttachmentViewer : AttachmentViewer;
  const indexOf = (f: AttachmentInfo) => files.indexOf(f);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "flex-start" }}>
        {items.map((it) =>
          it.kind === "image" ? (
            <span key={it.key} className="group" style={{ position: "relative", display: "inline-flex" }}>
              <button type="button" aria-label={`${it.file.name} を大きく表示`} onClick={() => setViewing(it.viewIndex)} style={{ display: "block", padding: 0, border: 0, background: "none", cursor: "zoom-in", touchAction: "manipulation" }}>
                <Picture file={it.file} box={it.box} fit="thumb" />
              </button>
              {onRemove && (
                <button
                  type="button"
                  aria-label={`${it.file.name} を外す`}
                  className={alwaysRemove || touch ? undefined : "opacity-0 group-hover:opacity-100 focus:opacity-100"}
                  onClick={() => onRemove(indexOf(it.file))}
                  style={touch ? { ...removeStyle, position: "absolute", top: 4, right: 4, width: 28, height: 28, borderRadius: 14 } : { ...removeStyle, position: "absolute", top: 4, right: 4 }}
                >
                  <X size={touch ? 14 : 12} />
                </button>
              )}
            </span>
          ) : (
            <Chip key={it.key} file={it.file} sizeText={it.sizeText} alwaysRemove={alwaysRemove} touch={touch} onRemove={onRemove ? () => onRemove(indexOf(it.file)) : undefined} />
          ),
        )}
      </div>
      {viewing !== null && images.length > 0 && <Viewer files={images} index={Math.min(viewing, images.length - 1)} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/**
 * Spec attachments §5.1: the picture on a dark screen. Esc or the backdrop closes it, ← / → step among `files`,
 * the top right opens it in the default app or shows it in Finder. Its Esc layer sits above the dialog's.
 */
export function AttachmentViewer({ files, index, onIndex, onClose }: { files: AttachmentInfo[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const act = useEnvAction();
  const env = useContext(AttachmentEnvContext);
  useEscLayer(true, onClose);
  // Modal: keys other than Esc (the Esc layers) stop here, before the dialog's j / k and the app's shortcuts see them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      e.stopPropagation();
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      onIndex(stepViewer(index, e.key === "ArrowLeft" ? -1 : 1, files.length));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, files.length, onIndex]);
  // Focus moves into the viewer (so typing does not reach a field behind it) and goes back where it was on close.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    rootRef.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  const file = files[index];
  if (!file) return null;
  const iconButton = (label: string, node: React.ReactNode, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ display: "grid", placeItems: "center", width: 36, height: 36, border: 0, borderRadius: 18, background: "rgba(255,255,255,0.14)", color: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1 }}
    >
      {node}
    </button>
  );
  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, outline: "none", display: "grid", placeItems: "center", background: "rgba(0,0,0,0.85)", fontFamily: "var(--font-body)" }}
    >
      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
        {iconButton("既定のアプリで開く", <ExternalLink size={18} />, () => act(() => env.open(file)))}
        {iconButton("Finder で表示", <FolderOpen size={18} />, () => act(() => env.reveal(file)))}
        {iconButton("閉じる", <X size={18} />, onClose)}
      </div>
      <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
        {iconButton("前の画像", <ChevronLeft size={20} />, () => onIndex(stepViewer(index, -1, files.length)), index === 0)}
      </div>
      <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
        {iconButton("次の画像", <ChevronRight size={20} />, () => onIndex(stepViewer(index, 1, files.length)), index >= files.length - 1)}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <Picture key={`${file.hash}.${file.ext}`} file={file} fit="full" />
      </div>
      <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, textAlign: "center", fontSize: 13, lineHeight: "19px", color: "rgba(255,255,255,0.85)" }}>
        {`${file.name}  ${formatBytes(file.size)}${files.length > 1 ? `  (${index + 1} / ${files.length})` : ""}`}
      </div>
    </div>,
    document.body,
  );
}
