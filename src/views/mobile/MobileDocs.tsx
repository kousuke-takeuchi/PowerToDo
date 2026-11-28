import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Ellipsis, FileText, Paperclip, Rows3, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { storeFiles } from "../../app/attachments/prepare";
import { rowLine } from "../../app/docList";
import type { MobileTab } from "../../app/mobileNav";
import { useDocs } from "../../app/useDocs";
import { useDocSaves } from "../../app/useDocSaves";
import { DocEditor } from "../../components/DocEditor";
import { ReferenceFiles } from "../../components/ReferenceFiles";
import type { AttachmentInfo, Doc, DocEdit } from "../../types/model";
import { BottomSheet, SheetCard, SheetRow } from "./BottomSheet";
import { MobileShell } from "./MobileShell";

const messageOf = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e);
const titleOf = (t: string) => (t === "" ? "無題" : t);

type Common = {
  fill?: boolean;
  onBack?: () => void;
  today?: string;
  onTabChange?: (t: MobileTab) => void;
  overlay?: React.ReactNode;
  banner?: React.ReactNode;
  /** A short message at the bottom (the app's flash). */
  onNotice: (text: string) => void;
};

/**
 * 「ドキュメント」 (spec 2026-11-28 §1, iPhone): a project's documents, or one section's, newest first. The add button
 * offers 「空のドキュメント」 and 「雛形から」; a row opens the document.
 */
export function MobileDocsList({ project, section, onOpen, onNotice, ...shell }: Common & { project: string; section: string | null; onOpen: (id: string) => void }) {
  const { list, error, create } = useDocs(project, section);
  const [adding, setAdding] = useState(false);
  const make = async (withTemplate: boolean) => {
    setAdding(false);
    try {
      onOpen((await create(withTemplate)).id);
    } catch (e) {
      onNotice(`ドキュメントを作れませんでした: ${messageOf(e)}`);
    }
  };
  return (
    <MobileShell
      banner={shell.banner}
      fill={shell.fill}
      title="ドキュメント"
      subtitle={section === null ? project : `${project} · ${section}`}
      largeTitle
      onBack={shell.onBack}
      tab="browse"
      today={shell.today}
      onTabChange={shell.onTabChange}
      fab
      onFab={() => setAdding(true)}
      overlay={
        <>
          {shell.overlay}
          <BottomSheet fill open={adding} title="ドキュメントを作る" onClose={() => setAdding(false)}>
            <SheetCard>
              <SheetRow icon={<FileText size={18} />} label="空のドキュメント" onClick={() => void make(false)} />
              <SheetRow icon={<Rows3 size={18} />} label="雛形から" onClick={() => void make(true)} />
            </SheetCard>
          </BottomSheet>
        </>
      }
    >
      <div style={{ padding: "0 15px" }}>
        {error && (
          <div role="alert" style={{ padding: "12px 0", fontSize: 14, color: "var(--color-danger)" }}>
            ドキュメントを読み込めませんでした: {error}
          </div>
        )}
        {!error && list.length === 0 && <div style={{ padding: "24px 0", fontSize: 15, color: "var(--color-text-secondary)" }}>ドキュメントはまだありません。右下の「+」で作ります。</div>}
        {list.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onOpen(d.id)}
            style={{ display: "block", width: "100%", padding: "12px 0", border: 0, borderBottom: "1px solid var(--color-border)", background: "none", textAlign: "left", fontFamily: "var(--font-body)", cursor: "pointer" }}
          >
            <div style={{ fontSize: 16, lineHeight: "22px", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleOf(d.title)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, lineHeight: "18px", color: "var(--color-text-muted)" }}>
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
    </MobileShell>
  );
}

/**
 * One document on iPhone: the title, the body (Crepe, with its top bar kept at the top of the scroll area) and the
 * 参考資料. 「…」: セクションを変える, 削除. Saving goes through `useDocSaves` like the desktop pane; leaving the screen
 * saves at once (the editor's unmount). A conflict or a deletion elsewhere shows the document the text went to.
 */
export function MobileDoc({ project, id, sections, onGone, onNotice, ...shell }: Common & { project: string; id: string; sections: string[]; onGone: () => void }) {
  const [open, setOpen] = useState<{ doc: Doc; rev: number } | null>(null);
  const [live, setLive] = useState<{ title: string; section: string | null; files: AttachmentInfo[] } | null>(null);
  const [sheet, setSheet] = useState<"menu" | "section" | "delete" | null>(null);
  const current = useRef<string>(id);
  const gone = useRef(false);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const show = (d: Doc, rev: number) => {
    current.current = d.id;
    setOpen({ doc: d, rev });
    setLive({ title: d.title, section: d.section, files: d.files });
  };
  // Shared with every document screen of the project: the screen left a moment ago may still be saving.
  const saves = useDocSaves(
    project,
    { notice: (t) => noticeRef.current(t), reload: () => undefined },
    {
      // Only while this screen still shows that document.
      moved: (from, d) => {
        if (!gone.current && current.current === from) show(d, saves.open(d));
      },
      written: (docId, d) => {
        if (current.current === docId) setLive({ title: d.title, section: d.section, files: d.files });
      },
    },
  );

  useEffect(() => {
    gone.current = false;
    // The saves queued by the screen that was left (its editor's flush on unmount) land before the read.
    saves
      .settled()
      .then(() => api.readDoc(project, id))
      .then(
        (d) => !gone.current && show(d, saves.open(d)),
        (e) => !gone.current && noticeRef.current(`ドキュメントを開けませんでした: ${messageOf(e)}`),
      );
    return () => {
      gone.current = true;
    };
    // The screen is keyed by project and id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (edit: DocEdit) => {
    const m = saves.meta(current.current);
    if (m) void saves.save(current.current, m.rev, edit);
  };
  const setFiles = (next: (cur: AttachmentInfo[]) => AttachmentInfo[]) => {
    const m = saves.meta(current.current);
    if (!m) return;
    const files = next(m.files);
    m.files = files;
    setLive((l) => (l ? { ...l, files } : l));
    change({ files });
  };
  const del = async () => {
    setSheet(null);
    const docId = current.current;
    try {
      await saves.beginDelete(docId);
      await api.deleteDoc(project, docId);
      saves.forget(docId);
      onGone();
    } catch (e) {
      onNotice(`削除できませんでした: ${messageOf(e)}`);
      // Text typed while the delete ran is sent now.
      void saves.deleteFailed(docId);
    }
  };

  return (
    <MobileShell
      banner={shell.banner}
      fill={shell.fill}
      title={live ? titleOf(live.title) : "ドキュメント"}
      subtitle={live?.section ?? project}
      onBack={shell.onBack}
      tab="browse"
      today={shell.today}
      onTabChange={shell.onTabChange}
      actions={open ? [{ icon: Ellipsis, label: "ドキュメントのメニュー", onClick: () => setSheet("menu") }] : []}
      overlay={
        <>
          {shell.overlay}
          <BottomSheet fill open={sheet !== null} title={sheet === "section" ? "セクションを変える" : sheet === "delete" ? "ドキュメントを削除" : live ? titleOf(live.title) : ""} onClose={() => setSheet(null)}>
            {sheet === "menu" && (
              <SheetCard label="ドキュメントの操作">
                <SheetRow icon={<Rows3 size={18} />} label="セクションを変える" value={live?.section ?? "プロジェクト全体"} chevron onClick={() => setSheet("section")} />
                <SheetRow icon={<Trash2 size={18} />} label="削除" danger onClick={() => setSheet("delete")} />
              </SheetCard>
            )}
            {sheet === "section" && (
              <SheetCard>
                {[null, ...sections].map((s) => (
                  <SheetRow
                    key={s ?? ""}
                    label={s ?? "プロジェクト全体"}
                    selected={(live?.section ?? null) === s}
                    onClick={() => {
                      setSheet(null);
                      setLive((l) => (l ? { ...l, section: s } : l));
                      change({ section: s });
                    }}
                  />
                ))}
              </SheetCard>
            )}
            {sheet === "delete" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>「{titleOf(live?.title ?? "")}」を削除しますか? archive フォルダに移します。</div>
                <SheetCard>
                  <SheetRow icon={<Trash2 size={18} />} label="本当に削除" danger onClick={() => void del()} />
                  <SheetRow label="キャンセル" onClick={() => setSheet(null)} />
                </SheetCard>
              </div>
            )}
          </BottomSheet>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 15px 32px" }}>
        {open && live ? (
          <>
            <DocEditor key={`${open.doc.id}:${open.rev}`} mobile doc={open.doc} onSave={(edit) => saves.save(open.doc.id, open.rev, edit)} onError={onNotice} />
            <ReferenceFiles
              mobile
              files={live.files}
              onAdd={(picked) =>
                void storeFiles(picked, (e) => noticeRef.current(messageOf(e))).then((infos) => {
                  if (infos.length) setFiles((cur) => [...cur, ...infos]);
                })
              }
              onOpen={(f) => void api.openAttachment(f).catch((e) => onNotice(messageOf(e)))}
              onRemove={(f) => setFiles((cur) => cur.filter((x) => !(x.hash === f.hash && x.ext === f.ext)))}
            />
          </>
        ) : (
          <div style={{ padding: "24px 0", fontSize: 15, color: "var(--color-text-secondary)" }}>読み込み中…</div>
        )}
      </div>
    </MobileShell>
  );
}
