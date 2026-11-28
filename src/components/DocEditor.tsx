import { useEffect, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";
import "./DocEditor.css";
import { api } from "../api/client";
import type { Doc, DocEdit } from "../types/model";
import { createAutosave } from "../app/autosave";
import { storeFiles } from "../app/attachments/prepare";
import { attachmentOfSrc, DOC_TEMPLATE, isEmptyBody, srcOfAttachment } from "../app/docMarkdown";

/**
 * A document's title and body (spec 2026-11-28). The body is Milkdown Crepe: its own toolbar, slash menu, tables,
 * link tooltip and image blocks. Images are stored with `add_attachment` and written as `../_attachments/<hash>.<ext>`;
 * the editor shows them through blob URLs (`proxyDomURL`), the Markdown keeps the relative path.
 * Saves 1 s after typing stops, and at once when the document is left (unmount, page hide).
 * `onSave` gets the title and body only; the parent adds the section and tracks `updated`.
 */
export function DocEditor({ doc, onSave, mobile }: { doc: Doc; onSave: (edit: DocEdit) => Promise<void>; mobile?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const crepe = useRef<Crepe | null>(null);
  const [title, setTitle] = useState(doc.title);
  const titleRef = useRef(doc.title);
  const [empty, setEmpty] = useState(isEmptyBody(doc.body));
  const urls = useRef<string[]>([]);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const save = useRef(
    createAutosave(() => {
      const body = crepe.current?.getMarkdown();
      void onSaveRef.current({ title: titleRef.current, ...(body !== undefined ? { body } : {}) });
    }),
  );

  const mount = (markdown: string) => {
    if (!host.current) return;
    const editor = new Crepe({
      root: host.current,
      defaultValue: markdown,
      features: { [Crepe.Feature.TopBar]: true, [Crepe.Feature.Latex]: false, [Crepe.Feature.AI]: false },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: "本文を書く。「/」で見出しや表を入れる", mode: "doc" },
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file: File) => {
            let failure: unknown;
            const [info] = await storeFiles([file], (e) => (failure = e));
            if (!info) throw failure ?? new Error("画像を保存できませんでした");
            return srcOfAttachment(info);
          },
          proxyDomURL: async (url: string) => {
            const f = attachmentOfSrc(url);
            if (!f) return url;
            try {
              const bytes = await api.readAttachment(f);
              const u = URL.createObjectURL(new Blob([bytes]));
              urls.current.push(u);
              return u;
            } catch {
              // Not synced yet (or lost): the image block shows its broken state with the alt text.
              return url;
            }
          },
        },
      },
    });
    editor.on((l) => {
      l.markdownUpdated((_ctx, md) => {
        setEmpty(isEmptyBody(md));
        save.current.touch();
      });
    });
    void editor.create();
    crepe.current = editor;
  };

  useEffect(() => {
    mount(doc.body);
    const leave = () => save.current.flush();
    const hidden = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      void crepe.current?.destroy();
      crepe.current = null;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
    // The parent keys this component by doc.id: one editor per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Links open in the browser, not in the WebView: with Cmd/Ctrl held on desktop, on tap on iPhone.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="http"]');
      if (!a) return;
      e.preventDefault();
      if (mobile || e.metaKey || e.ctrlKey) void openUrl(a.getAttribute("href")!).catch(() => undefined);
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, [mobile]);

  return (
    <div className={`doc-editor${mobile ? " doc-editor--mobile" : ""}`} onBlur={() => save.current.flush()}>
      <input
        className="doc-editor__title"
        aria-label="題名"
        value={title}
        placeholder="無題"
        onChange={(e) => {
          setTitle(e.target.value);
          titleRef.current = e.target.value;
          save.current.touch();
        }}
      />
      {empty && (
        <button
          type="button"
          className="doc-editor__template"
          onClick={() => {
            void crepe.current?.destroy();
            if (host.current) host.current.innerHTML = "";
            mount(DOC_TEMPLATE);
            setEmpty(false);
            save.current.touch();
          }}
        >
          雛形から始める
        </button>
      )}
      <div ref={host} className="doc-editor__body" />
    </div>
  );
}
