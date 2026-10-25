import { createContext, useCallback, useEffect, useReducer, useState } from "react";
import { api } from "../api/client";
import { onCommentsChanged } from "../api/events";
import type { Comment } from "../types/model";
import { dialogCommentsReducer, initialDialogComments } from "./dialogComments";

/** `${project}/${no}` -> number of comments, for the count on task rows (spec ① §3.3). Main provides it. */
export const CommentCounts = createContext<Record<string, number>>({});

/** The comment file of a task, as `comments-changed` names it. */
export function commentFile(project: string, no: number): string {
  return `${project}.${no}.jsonl`;
}

/** The project of a comment file name (`a.b.3.jsonl` -> `a.b`), or null. */
export function projectOfCommentFile(name: string): string | null {
  const m = /^(.+)\.(\d+)\.jsonl$/.exec(name);
  return m ? m[1] : null;
}

/**
 * The comments of the task in the dialog, kept fresh on `comments-changed`. A reply that comes after
 * the dialog moved to another task is dropped; a failed load sets `failed` (shown in the dialog), a
 * failed write goes to `onError`.
 */
export function useDialogComments(dialog: { project: string; no: number } | null, onError: (e: unknown) => void) {
  const [state, dispatch] = useReducer(dialogCommentsReducer, initialDialogComments);
  const project = dialog?.project;
  const no = dialog?.no;
  const key = project === undefined || no === undefined ? null : `${project}/${no}`;
  useEffect(() => dispatch({ type: "show", key }), [key]);
  const load = useCallback(() => {
    if (project === undefined || no === undefined) return;
    const k = `${project}/${no}`;
    api.listComments(project, no).then(
      (comments) => dispatch({ type: "loaded", key: k, comments }),
      () => dispatch({ type: "failed", key: k }),
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
  const run = (call: () => Promise<Comment[]>): Promise<boolean> => {
    const k = key;
    return call().then(
      (comments) => {
        if (k !== null) dispatch({ type: "loaded", key: k, comments });
        return true;
      },
      (e) => {
        onError(e);
        return false;
      },
    );
  };
  return {
    comments: state.comments,
    failed: state.failed,
    add: (text: string) => (project === undefined || no === undefined ? Promise.resolve(false) : run(() => api.addComment(project, no, text))),
    edit: (id: string, text: string) =>
      project === undefined || no === undefined ? Promise.resolve(false) : run(() => api.editComment(project, no, id, text)),
    remove: (id: string) => {
      if (project !== undefined && no !== undefined) void run(() => api.deleteComment(project, no, id));
    },
  };
}

/** Comment counts of the tasks of `projects` (the projects shown), reloaded on `comments-changed`. */
export function useCommentCounts(projects: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = [...new Set(projects)].sort().join("\u001f");
  const load = useCallback(
    (only?: Set<string>) => {
      const names = key ? key.split("\u001f") : [];
      for (const p of names) {
        if (only && !only.has(p)) continue;
        api.commentCounts(p).then(
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
