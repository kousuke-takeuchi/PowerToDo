import type { Comment } from "../types/model";

/**
 * The comments of the task in the dialog (`key` = `${project}/${no}`). A reply for another task (the
 * dialog moved on before it came) is dropped; `failed`: the last load failed (spec ① §3.6).
 */
export interface DialogComments {
  key: string | null;
  comments: Comment[];
  failed: boolean;
}

export type DialogCommentsAction =
  | { type: "show"; key: string | null }
  | { type: "loaded"; key: string; comments: Comment[] }
  | { type: "failed"; key: string };

export const initialDialogComments: DialogComments = { key: null, comments: [], failed: false };

export function dialogCommentsReducer(s: DialogComments, a: DialogCommentsAction): DialogComments {
  switch (a.type) {
    case "show":
      return a.key === s.key ? s : { key: a.key, comments: [], failed: false };
    case "loaded":
      return a.key === s.key ? { ...s, comments: a.comments, failed: false } : s;
    case "failed":
      return a.key === s.key ? { ...s, failed: true } : s;
  }
}
