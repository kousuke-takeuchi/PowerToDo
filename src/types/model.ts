import type { SyncState } from "../components/SyncStatus";

export type { SyncState };

export type Priority = 1 | 2 | 3 | 4;
export interface Task { no: number; project: string; category: string | null; title: string; assignee: string; priority: Priority; progress: number; start?: string; due?: string; dueTime?: string; days?: number; note?: string; parentNo?: number; labels: string[]; rrule?: string; reminders: string[]; order: number; createdAt: string; completedAt?: string; }
export interface Project { name: string; color: string; order: number; favorite: boolean; inbox: boolean; }
export interface Label { name: string; color: string; order: number; }
export interface Section { project: string; name: string; order: number; collapsed?: boolean; }
export interface SyncInfo { state: SyncState; lastSyncedAt?: string; target: "google" | "nas" | "none"; account?: string; }
export interface Comment { taskNo: number; author: string; at: string; text: string; }

// ---- Rust command DTOs (src-tauri: commands/mod.rs, store/project_store.rs, domain/*) ----

export interface ProjectSummary { name: string; color: string; order: number; favorite: boolean; inbox: boolean; taskCount: number; loadError?: string; }
/** A row whose cell types are broken in the xlsx (reported, never rewritten). */
export interface InvalidRow { row: number; no?: number; column: string; value: string; message: string; }
export interface ProjectView { project: Project; sections: Section[]; tasks: Task[]; invalidRows: InvalidRow[]; }

export interface TaskInput { title: string; section?: string | null; priority?: Priority | null; due?: string | null; dueTime?: string | null; note?: string | null; labels?: string[]; parentNo?: number | null; }
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

export type TokenKind = "date" | "time" | "priority" | "project" | "label";
/** Offsets are char (code point) indices into the original text, not UTF-16 units. */
export interface Span { start: number; end: number; kind: TokenKind; }
/** Rust serializes the absent Options as null (no skip_serializing_if); dueTime is "HH:MM". */
export interface QuickAddResult { title: string; due: string | null; dueTime: string | null; priority: Priority | null; project: string | null; labels: string[]; spans: Span[]; }
export interface QuickAddOutcome { parsed: QuickAddResult; view: ProjectView; }
export interface MoveOutcome { from: ProjectView; to: ProjectView; }

export type AppErrorKind = "not_found" | "invalid" | "io" | "locked" | "corrupt" | "unsaved";
export interface AppError { kind: AppErrorKind; message: string; }

/** `save-status` event payload. `project` is a project name or "_common". */
export type SaveState = "saving" | "saved" | "error";
export interface SaveStatus { project: string; state: SaveState; message?: string; }

export interface AppStateDto { dataDir: string | null; projects: ProjectSummary[]; inbox: string; warning?: string; }
export interface SettingsDto { displayName: string; weekStart: "mon" | "sun"; dataDir?: string; }
