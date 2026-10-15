import type { SyncState } from "../components/SyncStatus";

export type { SyncState };

export type Priority = 1 | 2 | 3 | 4;
export interface Task { no: number; project: string; category: string | null; title: string; assignee: string; priority: Priority; progress: number; start?: string; due?: string; dueTime?: string; days?: number; note?: string; parentNo?: number; labels: string[]; rrule?: string; /** 表示用 (要約、読めなければ RRULE 文字列)。保存されない。 */ rruleLabel?: string; reminders: string[]; order: number; createdAt: string; completedAt?: string; }
export interface Project { name: string; color: string; order: number; favorite: boolean; inbox: boolean; }
export interface Label { name: string; color: string; order: number; }
export interface Section { project: string; name: string; order: number; collapsed?: boolean; }
export interface SyncInfo { state: SyncState; lastSyncedAt?: string; target: "google" | "nas" | "none"; account?: string; }
export interface Comment { taskNo: number; author: string; at: string; text: string; }

// ---- Rust command DTOs (src-tauri: commands/mod.rs, store/project_store.rs, domain/*) ----

export interface ProjectSummary { name: string; color: string; order: number; favorite: boolean; inbox: boolean; taskCount: number; loadError?: string; }
/** A row whose cell types are broken in the xlsx (reported, never rewritten). */
export interface InvalidRow { row: number; no?: number; column: string; value: string; message: string; }
export interface ProjectView { project: Project; sections: Section[]; tasks: Task[]; invalidRows: InvalidRow[]; /** 操作についての通知 (例: 繰り返しが読めず通常の完了になった)。 */ warnings?: string[]; }

export interface TaskInput { title: string; section?: string | null; priority?: Priority | null; due?: string | null; dueTime?: string | null; note?: string | null; labels?: string[]; parentNo?: number | null; rrule?: string | null; reminders?: string[]; }
/** undefined = unchanged, null = clear the value (Rust `Option<Option<T>>`). */
export interface TaskPatch {
  title?: string;
  category?: string | null;
  assignee?: string;
  priority?: Priority;
  progress?: number;
  start?: string | null;
  due?: string | null;
  dueTime?: string | null;
  note?: string | null;
  parentNo?: number | null;
  labels?: string[];
  rrule?: string | null;
  reminders?: string[];
  order?: number;
}

export type TokenKind = "date" | "time" | "priority" | "project" | "label" | "recurrence";
/** Offsets are char (code point) indices into the original text, not UTF-16 units. */
export interface Span { start: number; end: number; kind: TokenKind; }
/** Rust serializes the absent Options as null (no skip_serializing_if); dueTime is "HH:MM". */
export interface QuickAddResult { title: string; due: string | null; dueTime: string | null; rrule: string | null; priority: Priority | null; project: string | null; labels: string[]; spans: Span[]; }
export interface QuickAddOutcome { parsed: QuickAddResult; view: ProjectView; }
export interface MoveOutcome { from: ProjectView; to: ProjectView; }

export type AppErrorKind = "not_found" | "invalid" | "io" | "locked" | "corrupt" | "unsaved";
export interface AppError { kind: AppErrorKind; message: string; }

/** `save-status` event payload. `project` is a project name or "_common". */
export type SaveState = "saving" | "saved" | "error";
export interface SaveStatus { project: string; state: SaveState; message?: string; }

/** `watchError`: watching the data folder could not start (the reason). Shown once by the main screen. */
export interface AppStateDto { dataDir: string | null; projects: ProjectSummary[]; inbox: string; warning?: string; watchError?: string; }
export interface SettingsDto {
  displayName: string;
  weekStart: "mon" | "sun";
  /** リマインダーコード (例 "-0m")。null = なし。 */
  defaultReminder: string | null;
  /** 時刻なしのタスクを通知する時刻 "HH:MM"。 */
  notifyTime: string;
  keepInTray: boolean;
  notifications: boolean;
  dataDir?: string;
}

// ---- Phase 2 ----
export interface TodayViewDto { overdue: Task[]; today: Task[]; }
export interface DayGroup { date: string; tasks: Task[]; }
export interface UpcomingDto { days: DayGroup[]; }
export interface LabelViewDto { label: Label; tasks: Task[]; }
export interface LabelsDto { labels: Label[]; counts: Record<string, number>; }
export interface LabelRenamed { label: Label; changedProjects: string[]; }
export interface ChangedProjects { changedProjects: string[]; }
export type Matched = "title" | "note" | "label";
export interface SearchHit { task: Task; matched: Matched; }
export interface SearchDto { hits: SearchHit[]; }
export interface CountsDto { today: number; labels: Record<string, number>; }
export type ChangeReason = "bulk" | "external" | "move";

/** `projects-changed` payload. `commonReloaded`: the common workbook was re-read from its file in this batch. */
export interface ProjectsChanged {
  commonReloaded: boolean;
}
