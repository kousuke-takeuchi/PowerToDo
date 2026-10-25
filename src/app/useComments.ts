import { createContext, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { onCommentsChanged } from "../api/events";
import type { Comment } from "../types/model";

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

/** The comments of the task in the dialog, kept fresh on `comments-changed`; writes report errors through `onError`. */
export function useDialogComments(dialog: { project: string; no: number } | null, onError: (e: unknown) => void) {
  const [comments, setComments] = useState<Comment[]>([]);
  const project = dialog?.project;
  const no = dialog?.no;
  const load = useCallback(() => {
    if (project === undefined || no === undefined) {
      setComments([]);
      return;
    }
    api.listComments(project, no).then(setComments, onError);
  }, [project, no, onError]);
  useEffect(load, [load]);
  useEffect(
    () =>
      onCommentsChanged((files) => {
        if (project !== undefined && no !== undefined && files.includes(commentFile(project, no))) load();
      }),
    [project, no, load],
  );
  const run = (call: () => Promise<Comment[]>): Promise<boolean> =>
    call().then(
      (list) => {
        setComments(list);
        return true;
      },
      (e) => {
        onError(e);
        return false;
      },
    );
  return {
    comments,
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
