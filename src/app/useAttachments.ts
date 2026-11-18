import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { onCommentsChanged } from "../api/events";
import type { AttachmentInfo, NoteFile } from "../types/model";
import { defaultAttachmentEnv, type AttachmentEnv } from "./attachments/env";
import { storeFiles } from "./attachments/prepare";
import { commentFile, projectOfCommentFile } from "./useComments";

/** Attachments per task of the projects shown (the row's paperclip), reloaded on `comments-changed` (every attach writes a comment file). */
export function useAttachmentCounts(projects: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = [...new Set(projects)].sort().join("\u001f");
  const load = useCallback(
    (only?: Set<string>) => {
      const names = key ? key.split("\u001f") : [];
      for (const p of names) {
        if (only && !only.has(p)) continue;
        api.attachmentCounts(p).then(
          (byNo) =>
            setCounts((cur) => {
              const next: Record<string, number> = {};
              for (const [k, v] of Object.entries(cur)) if (!k.startsWith(`${p}/`)) next[k] = v;
              for (const [n, c] of Object.entries(byNo)) next[`${p}/${n}`] = c;
              return next;
            }),
          () => undefined,
        );
      }
    },
    [key],
  );
  useEffect(() => load(), [load]);
  useEffect(
    () =>
      onCommentsChanged((files) => {
        const touched = new Set(files.map(projectOfCommentFile).filter((p): p is string => p !== null));
        load(touched);
      }),
    [load],
  );
  return counts;
}

/**
 * The description's attachments of the task in the dialog, and what the dialog does with them: `store` (comment
 * composer: shrink + save the files), `attach` (description: the same, then pointed at by the description),
 * `detach` (at once; `undo` offers 「元に戻す」 that attaches the file again).
 */
export function useNoteFiles(
  dialog: { project: string; no: number } | null,
  onError: (e: unknown) => void,
  undo: (text: string, action: string, run: () => void) => void,
) {
  const project = dialog?.project;
  const no = dialog?.no;
  const key = project === undefined || no === undefined ? null : `${project}/${no}`;
  const [state, setState] = useState<{ key: string | null; files: NoteFile[] }>({ key: null, files: [] });
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => setState({ key, files: [] }), [key]);
  const load = useCallback(() => {
    if (project === undefined || no === undefined) return;
    const k = `${project}/${no}`;
    api.listNoteFiles(project, no).then(
      (files) => setState((s) => (s.key === k ? { key: k, files } : s)),
      () => undefined,
    );
  }, [project, no]);
  useEffect(load, [load]);
  useEffect(
    () =>
      onCommentsChanged((files) => {
        if (project !== undefined && no !== undefined && files.includes(commentFile(project, no))) load();
      }),
    [project, no, load],
  );
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const store = useCallback((files: File[]) => storeFiles(files, (e) => errorRef.current(e)), []);
  const accept = (k: string, files: NoteFile[]) => setState((s) => (s.key === k ? { key: k, files } : s));
  const attachInfos = async (infos: AttachmentInfo[]) => {
    if (project === undefined || no === undefined || key === null) return;
    for (const info of infos) {
      try {
        accept(key, await api.attachToNote(project, no, info));
      } catch (e) {
        onError(e);
      }
    }
  };
  return {
    files: state.key === key ? state.files : [],
    store,
    attach: async (files: File[]) => attachInfos(await store(files)),
    detach: async (id: string) => {
      if (project === undefined || no === undefined || key === null) return;
      const target = state.files.find((f) => f.id === id);
      try {
        accept(key, await api.detachFromNote(project, no, id));
      } catch (e) {
        onError(e);
        return;
      }
      if (target) {
        const k = key;
        undo(`「${target.file.name}」を外しました`, "元に戻す", () => {
          if (keyRef.current === k) void attachInfos([target.file]);
          else void api.attachToNote(project, no, target.file).catch(onError);
        });
      }
    },
  };
}

/** The environment the attachment views run in: the backend, and whether a sync may still bring a missing file. */
export function useAttachmentEnv(syncing: boolean, onError: (e: unknown) => void): AttachmentEnv {
  const errorRef = useRef(onError);
  errorRef.current = onError;
  return useMemo(() => ({ ...defaultAttachmentEnv, syncing, onError: (e) => errorRef.current(e) }), [syncing]);
}
