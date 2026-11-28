import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, Ellipsis, Paperclip, Plus, X } from "lucide-react";
import { api } from "../api/client";
import { useDocs } from "../app/useDocs";
import { useDocSaves } from "../app/useDocSaves";
import { rowLine } from "../app/docList";
import { storeFiles } from "../app/attachments/prepare";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { DocEditor } from "../components/DocEditor";
import { ReferenceFiles } from "../components/ReferenceFiles";
import type { AttachmentInfo, Doc, DocEdit } from "../types/model";

const messageOf = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e);
const titleOf = (t: string) => (t === "" ? "無題" : t);

type MenuItem = { label: string; onClick?: () => void; /** Opens this list in the same menu instead of acting. */ children?: MenuItem[]; current?: boolean; danger?: boolean };

/** A small popover menu under its button; closes on a click elsewhere or Esc. */
function MenuButton({ ariaLabel, icon, items, align = "right" }: { ariaLabel: string; icon: React.ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<MenuItem[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEscLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) setSub(null);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <Button variant="icon" ariaLabel={ariaLabel} onClick={() => setOpen((o) => !o)}>
        {icon}
      </Button>
      {open && (
        <div
          role="menu"
          style={{ position: "absolute", [align]: 0, top: "100%", zIndex: 20, minWidth: 180, maxHeight: 320, overflowY: "auto", padding: "4px 0", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "var(--shadow-popover)" }}
        >
          {(sub ?? items).map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                if (it.children) {
                  setSub(it.children);
                  return;
                }
                setOpen(false);
                it.onClick?.();
              }}
              className="bg-transparent hover:bg-[var(--color-bg-hover)]"
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 12px", border: 0, textAlign: "left", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: "20px", color: it.danger ? "var(--color-danger, #d1453b)" : "var(--color-text-primary)", cursor: "pointer" }}
            >
              <span style={{ width: 16, display: "inline-flex" }}>{it.current && <Check size={14} />}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfirmDelete({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) {
  useEscLayer(true, onCancel);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="alertdialog" aria-label="ドキュメントの削除" style={{ width: 384, boxSizing: "border-box", padding: "20px 16px 16px", borderRadius: 10, background: "var(--color-bg)", boxShadow: "var(--shadow-dialog)", fontFamily: "var(--font-body)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px", color: "var(--color-text-primary)" }}>ドキュメントを削除</div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>「{titleOf(title)}」を削除しますか? archive フォルダに移します。</div>
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

/**
 * The ドキュメント half of a project screen (spec 2026-11-28 §1): the list of documents (260px) and the open one.
 * Saving goes through `useDocSaves` (one queue for the project's saves; the base each save sends is decided when it
 * runs; saves an editor still had queued after a conflict go to the copy of its text). Every save sends the last known
 * title, body and section, so a copy made for a deleted document keeps them.
 * `docs-changed` only reloads the list; the open document is not read again (the app's own saves echo back).
 */
export function DocsPane({
  project,
  section,
  onSection,
  sections,
  onNotice,
  initialOpen,
}: {
  project: string;
  section: string | null;
  onSection: (s: string | null) => void;
  /** The project's section names, for 「セクションを変える」. */
  sections: string[];
  onNotice: (text: string) => void;
  /** Storybook only: a document id to open at the first draw. */
  initialOpen?: string;
}) {
  const { list, error, reload, create, remove } = useDocs(project, section);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [open, setOpen] = useState<{ doc: Doc; rev: number } | null>(null);
  const [live, setLive] = useState<{ title: string; section: string | null; files: AttachmentInfo[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const readN = useRef(0);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const pick = (id: string | null) => {
    selectedRef.current = id;
    setSelected(id);
  };
  /** Shows `d` in an editor with `rev` (a new editor is mounted); a read still in flight no longer replaces it. */
  const show = (d: Doc, rev: number) => {
    readN.current++;
    pick(d.id);
    setOpen({ doc: d, rev });
    setLive({ title: d.title, section: d.section, files: d.files });
  };
  const saves = useDocSaves(
    project,
    { notice: (t) => noticeRef.current(t), reload },
    {
      // Only the screen still on that document moves; elsewhere the notice and the list are enough.
      moved: (from, d) => {
        if (selectedRef.current === from) show(d, saves.open(d));
      },
      written: (id, d) => {
        if (selectedRef.current === id) setLive({ title: d.title, section: d.section, files: d.files });
      },
    },
  );
  const select = async (id: string) => {
    if (id === selectedRef.current) return;
    pick(id);
    setOpen(null);
    setLive(null);
    const n = ++readN.current;
    try {
      // Saves still queued (its editor, or an editor whose text went to it, was left a moment ago) land first:
      // the read then sees them.
      await saves.settled();
      const d = await api.readDoc(project, id);
      if (n === readN.current) show(d, saves.open(d));
    } catch (e) {
      if (n === readN.current) {
        pick(null);
        noticeRef.current(`ドキュメントを開けませんでした: ${messageOf(e)}`);
      }
    }
  };

  const make = async (withTemplate: boolean) => {
    try {
      const d = await create(withTemplate);
      show(d, saves.open(d));
    } catch (e) {
      onNotice(`ドキュメントを作れませんでした: ${messageOf(e)}`);
    }
  };
  const del = async () => {
    const id = selectedRef.current;
    setDeleting(false);
    if (!id) return;
    try {
      // The text typed so far is saved first, then archived with it; nothing is saved after.
      await saves.beginDelete(id);
      await remove(id);
      saves.forget(id);
      pick(null);
      setOpen(null);
      setLive(null);
    } catch (e) {
      onNotice(`削除できませんでした: ${messageOf(e)}`);
      // Text typed while the delete ran is sent now.
      void saves.deleteFailed(id);
    }
  };
  /** A change of the open document's section or files, saved at once with its current rev. */
  const change = (edit: DocEdit) => {
    const id = selectedRef.current;
    const m = id ? saves.meta(id) : undefined;
    if (!id || !m) return;
    void saves.save(id, m.rev, edit);
  };
  const setFiles = (next: (cur: AttachmentInfo[]) => AttachmentInfo[]) => {
    const id = selectedRef.current;
    const m = id ? saves.meta(id) : undefined;
    if (!id || !m) return;
    const files = next(m.files);
    m.files = files; // at once, so a second change before the save returns builds on this one
    setLive((l) => (l ? { ...l, files } : l));
    change({ files });
  };
  const addFiles = async (picked: File[]) => {
    const id = selectedRef.current;
    const infos = await storeFiles(picked, (e) => noticeRef.current(messageOf(e)));
    if (!infos.length) return;
    if (selectedRef.current === id) setFiles((cur) => [...cur, ...infos]);
    else noticeRef.current("ほかのドキュメントに移ったため、ファイルを付けませんでした");
  };

  useEffect(() => {
    if (initialOpen) void select(initialOpen);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createItems: MenuItem[] = [
    { label: "空のドキュメント", onClick: () => void make(false) },
    { label: "雛形から", onClick: () => void make(true) },
  ];
  const sectionItems: MenuItem[] = [
    { label: "プロジェクト全体", current: live?.section === null, onClick: () => change({ section: null }) },
    ...sections.map((s) => ({ label: s, current: live?.section === s, onClick: () => change({ section: s }) })),
  ];
  const mutedLine: React.CSSProperties = { fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 24, minHeight: 480, height: "calc(100vh - 220px)", marginTop: "var(--space-4)", fontFamily: "var(--font-body)" }}>
      <aside aria-label="ドキュメントの一覧" style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--color-border)", paddingRight: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 36 }}>
          <h2 style={{ margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>ドキュメント</h2>
          <MenuButton ariaLabel="ドキュメントを作る" icon={<Plus size={18} />} items={createItems} />
        </div>
        {section !== null && (
          <div style={{ display: "flex", margin: "4px 0 8px" }}>
            <button
              type="button"
              onClick={() => onSection(null)}
              aria-label={`セクション: ${section} の絞り込みを外す`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", padding: "2px 8px", border: 0, borderRadius: 12, background: "var(--color-accent-soft)", color: "var(--color-text-primary)", fontFamily: "var(--font-body)", fontSize: 12, lineHeight: "18px", cursor: "pointer" }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>セクション: {section}</span>
              <X size={12} />
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {error && <div role="alert" style={{ ...mutedLine, padding: 8 }}>ドキュメントを読み込めませんでした: {error}</div>}
          {!error && list.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, padding: "16px 8px" }}>
              <div style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>ドキュメントはまだありません</div>
              <Button variant="secondary" onClick={() => void make(false)}>
                空のドキュメント
              </Button>
              <Button variant="secondary" onClick={() => void make(true)}>
                雛形から
              </Button>
            </div>
          )}
          {list.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => void select(d.id)}
              aria-current={d.id === selected || undefined}
              className={d.id === selected ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
              style={{ display: "block", width: "100%", padding: "8px 10px", border: 0, borderRadius: 6, textAlign: "left", fontFamily: "var(--font-body)", cursor: "pointer", background: d.id === selected ? "var(--color-bg-hover)" : undefined }}
            >
              <div style={{ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleOf(d.title)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, ...mutedLine }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rowLine(d)}</span>
                {d.files > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 2, flex: "0 0 auto" }} aria-label={`参考資料 ${d.files} 件`}>
                    <Paperclip size={12} />
                    {d.files}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section aria-label="ドキュメント" style={{ minWidth: 0, minHeight: 0, overflowY: "auto" }}>
        {open && live ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", height: 32 }}>
              <MenuButton
                ariaLabel="ドキュメントのメニュー"
                icon={<Ellipsis size={18} />}
                items={[
                  { label: "セクションを変える", children: sectionItems },
                  { label: "削除", danger: true, onClick: () => setDeleting(true) },
                ]}
              />
            </div>
            <DocEditor key={`${open.doc.id}:${open.rev}`} doc={open.doc} onSave={(edit) => saves.save(open.doc.id, open.rev, edit)} onError={onNotice} />
            <ReferenceFiles
              files={live.files}
              onAdd={(f) => void addFiles(f)}
              onOpen={(f) => void api.openAttachment(f).catch((e) => onNotice(messageOf(e)))}
              onRemove={(f) => setFiles((cur) => cur.filter((x) => !(x.hash === f.hash && x.ext === f.ext)))}
            />
          </div>
        ) : (
          <div style={{ padding: 24, fontSize: 13, lineHeight: "19px", color: "var(--color-text-muted)" }}>{selected ? "" : "左の一覧から選ぶか、「+」で作る"}</div>
        )}
      </section>
      {deleting && live && <ConfirmDelete title={live.title} onCancel={() => setDeleting(false)} onConfirm={() => void del()} />}
    </div>
  );
}
