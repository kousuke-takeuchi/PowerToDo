import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  AppErrorKind,
  AppStateDto,
  MoveOutcome,
  ProjectSummary,
  ProjectView,
  QuickAddOutcome,
  QuickAddResult,
  SettingsDto,
  TaskInput,
  TaskPatch,
} from "../types/model";

/** Typed wrapper over Tauri `invoke`. Command names and argument keys follow src-tauri/src/commands/mod.rs (camelCase of the Rust params). */
export const api = {
  appState: () => invoke<AppStateDto>("app_state"),
  setDataDir: (path: string) => invoke<AppStateDto>("set_data_dir", { path }),
  pickFolder: () => invoke<string | null>("pick_folder"),
  revealDataDir: () => invoke<null>("reveal_data_dir"),
  /** `project` is a project name, or "_common" for the common workbook. */
  retrySave: (project: string) => invoke<null>("retry_save", { project }),

  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  getProject: (name: string) => invoke<ProjectView>("get_project", { name }),
  /** Re-reads the project file from disk (discards unsaved in-memory changes); retries a failed load. */
  reloadProject: (name: string) => invoke<ProjectView>("reload_project", { name }),
  createProject: (name: string, color: string) => invoke<ProjectSummary>("create_project", { name, color }),
  renameProject: (name: string, newName: string) => invoke<ProjectSummary>("rename_project", { name, newName }),
  deleteProject: (name: string) => invoke<null>("delete_project", { name }),

  addSection: (project: string, name: string) => invoke<ProjectView>("add_section", { project, name }),
  renameSection: (project: string, name: string, newName: string) => invoke<ProjectView>("rename_section", { project, name, newName }),
  reorderSections: (project: string, names: string[]) => invoke<ProjectView>("reorder_sections", { project, names }),

  addTask: (project: string, input: TaskInput) => invoke<ProjectView>("add_task", { project, input }),
  updateTask: (project: string, no: number, patch: TaskPatch) => invoke<ProjectView>("update_task", { project, no, patch }),
  completeTask: (project: string, no: number, done: boolean) => invoke<ProjectView>("complete_task", { project, no, done }),
  deleteTask: (project: string, no: number) => invoke<ProjectView>("delete_task", { project, no }),
  moveTask: (project: string, no: number, toProject: string, toSection?: string | null) =>
    invoke<MoveOutcome>("move_task", { project, no, toProject, toSection: toSection ?? null }),
  reorderTasks: (project: string, section: string | null, order: number[]) => invoke<ProjectView>("reorder_tasks", { project, section, order }),

  quickAdd: (text: string, defaultProject: string) => invoke<QuickAddOutcome>("quick_add", { text, defaultProject }),
  parseQuickAdd: (text: string) => invoke<QuickAddResult>("parse_quick_add", { text }),

  settings: () => invoke<SettingsDto>("settings"),
  updateSettings: (settings: SettingsDto) => invoke<SettingsDto>("update_settings", { settings }),
};

const kinds: readonly AppErrorKind[] = ["not_found", "invalid", "io", "locked", "corrupt"];

/** Tauri rejects with the serialized Rust `AppError` ({ kind, message }). */
export function isAppError(e: unknown): e is AppError {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.message === "string" && typeof o.kind === "string" && (kinds as readonly string[]).includes(o.kind);
}

/** A user-presentable message for anything a command can reject with. */
export function errorMessage(e: unknown): string {
  if (isAppError(e)) return e.message;
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
