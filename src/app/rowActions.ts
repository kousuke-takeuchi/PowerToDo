import { createContext } from "react";
import type { Position, Task } from "../types/model";
import type { PickerProject } from "../views/ProjectPicker";
import type { EditorValue } from "../views/taskEditorValue";

/** Spec ② §2–§4: what task rows need to edit, add and act on tasks. Main provides it. */
export type RowActionsApi = {
  today: string;
  inbox: string;
  projects: PickerProject[];
  allLabels: string[];
  /** taskKey being edited inline, or null. */
  editing: string | null;
  setEditing: (key: string | null) => void;
  /** Where the add editor sits next to a row. */
  inserting: { project: string; anchorNo: number; where: "before" | "after" } | null;
  setInserting: (i: RowActionsApi["inserting"]) => void;
  /** A row with an open menu or date picker (row keys are off while set). */
  overlay: string | null;
  setOverlay: (key: string | null) => void;
  save: (t: Task, before: EditorValue, after: EditorValue) => Promise<boolean>;
  /** Resolves the new task's No., or null on failure. */
  add: (v: EditorValue, opts?: { parentNo?: number; position?: Position }) => Promise<number | null>;
  setDue: (t: Task, due: string | undefined) => void;
  setPriority: (t: Task, p: 1 | 2 | 3 | 4) => void;
  setReminders: (t: Task, r: string[]) => void;
  move: (t: Task, project: string, section: string | null) => void;
  duplicate: (t: Task) => void;
  requestDelete: (t: Task) => void;
  openComments: (t: Task) => void;
};

/** Without it (Storybook) rows keep the plain behaviour. */
export const RowActions = createContext<RowActionsApi | null>(null);
