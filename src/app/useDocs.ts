import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { onDocsChanged } from "../api/events";
import type { Doc, DocSummary } from "../types/model";
import { DOC_TEMPLATE, projectOfDocLeaf } from "./docMarkdown";

/** The documents of a project, or of one section of it (`section`), newest first; follows `docs-changed`. */
export function useDocs(project: string, section: string | null) {
  const [all, setAll] = useState<DocSummary[]>([]);
  const [error, setError] = useState<string>();
  // Only the newest request may set the list: a late answer for an earlier project (or an earlier reload) is dropped.
  const request = useRef(0);
  const reload = useCallback(() => {
    const n = ++request.current;
    api.listDocs(project).then(
      (l) => {
        if (n !== request.current) return;
        setAll(l);
        setError(undefined);
      },
      (e) => {
        if (n !== request.current) return;
        setError(String(e?.message ?? e));
      },
    );
  }, [project]);
  useEffect(() => {
    setAll([]);
    setError(undefined);
    reload();
    const off = onDocsChanged((files) => {
      if (files.some((f) => projectOfDocLeaf(f) === project)) reload();
    });
    return () => {
      off();
      request.current++;
    };
  }, [project, reload]);
  const list = section === null ? all : all.filter((d) => d.section === section);
  const create = async (withTemplate: boolean): Promise<Doc> => {
    const d = await api.createDoc(project, section, "", withTemplate ? DOC_TEMPLATE : "");
    reload();
    return d;
  };
  const remove = async (id: string) => {
    await api.deleteDoc(project, id);
    reload();
  };
  return { list, error, reload, create, remove };
}
