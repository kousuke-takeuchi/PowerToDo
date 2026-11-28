import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { onDocsChanged } from "../api/events";
import type { Doc, DocSummary } from "../types/model";
import { DOC_TEMPLATE } from "./docMarkdown";

/** The documents of a project, or of one section of it (`section`), newest first; follows `docs-changed`. */
export function useDocs(project: string, section: string | null) {
  const [all, setAll] = useState<DocSummary[]>([]);
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    api.listDocs(project).then(
      (l) => {
        setAll(l);
        setError(undefined);
      },
      (e) => setError(String(e?.message ?? e)),
    );
  }, [project]);
  useEffect(() => {
    reload();
    const off = onDocsChanged((files) => {
      if (files.some((f) => f.startsWith(`${project}.`))) reload();
    });
    return off;
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
