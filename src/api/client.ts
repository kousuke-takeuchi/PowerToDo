import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  AppErrorKind,
  AppStateDto,
  ChangedProjects,
  CountsDto,
  Label,
  LabelRenamed,
  LabelViewDto,
  LabelsDto,
  MoveOutcome,
  NotificationPermission,
  PendingRemindersDto,
  ProjectSummary,
  ProjectView,
  QuickAddOutcome,
  QuickAddResult,
  RecurrenceDto,
  RecurrenceLabelDto,
  SearchDto,
  SettingsDto,
  TaskInput,
  TaskPatch,
  TodayViewDto,
  UpcomingDto,
} from "../types/model";

/** Typed wrapper over Tauri `invoke`. Command names and argument keys follow src-tauri/src/commands/mod.rs (camelCase of the Rust params). */
export const api = {
  appState: () => invoke<AppStateDto>("app_state"),
  setDataDir: (path: string) => invoke<AppStateDto>("set_data_dir", { path }),
  /** Why watching the data folder could not start, or null while it runs. */
  watchStatus: () => invoke<string | null>("watch_status"),
  pickFolder: () => invoke<string | null>("pick_folder"),
  revealDataDir: () => invoke<null>("reveal_data_dir"),
  /** `project` is a project name, or "_common" for the common workbook. */
  retrySave: (project: string) => invoke<null>("retry_save", { project }),
  /**
   * The user's choice for a project (or "_common") that changed on disk while it had unsaved edits.
   * `reload` drops ours (returns the new view; null for "_common"), `overwrite` saves ours now.
   */
  resolveExternalChange: (project: string, action: "reload" | "overwrite") =>
    invoke<ProjectView | null>("resolve_external_change", { project, action }),
  /** Projects (or "_common") currently held back from saving because of an external change. */
  heldProjects: () => invoke<string[]>("held_projects"),
  /** Exits for real, after the held projects that blocked the exit were resolved. */
  quit: () => invoke<void>("quit"),

  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  getProject: (name: string) => invoke<ProjectView>("get_project", { name }),
  /**
   * Re-reads the project file from disk; retries a failed load. With unsaved in-memory changes it rejects with an
   * `invalid` AppError unless `discard` is true (then the changes are dropped).
   */
  reloadProject: (name: string, discard = false) => invoke<ProjectView>("reload_project", { name, discard }),
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
  parseRecurrence: (text: string) => invoke<RecurrenceDto>("parse_recurrence", { text }),
  summarizeRecurrence: (rrule: string) => invoke<RecurrenceLabelDto>("summarize_recurrence", { rrule }),

  settings: () => invoke<SettingsDto>("settings"),
  updateSettings: (settings: SettingsDto) => invoke<SettingsDto>("update_settings", { settings }),

  // ---- Phase 2: cross-project views, labels, search ----
  todayView: (today: string) => invoke<TodayViewDto>("today_view", { today }),
  upcomingView: (from: string, days: number) => invoke<UpcomingDto>("upcoming_view", { from, days }),
  labelView: (label: string) => invoke<LabelViewDto>("label_view", { label }),
  labels: () => invoke<LabelsDto>("labels"),
  addLabel: (name: string, color: string) => invoke<Label>("add_label", { name, color }),
  updateLabel: (name: string, color: string) => invoke<Label>("update_label", { name, color }),
  renameLabel: (name: string, newName: string) => invoke<LabelRenamed>("rename_label", { name, newName }),
  deleteLabel: (name: string) => invoke<ChangedProjects>("delete_label", { name }),
  rescheduleOverdue: (today: string, due: string) => invoke<ChangedProjects>("reschedule_overdue", { today, due }),
  search: (query: string, includeDone: boolean, limit = 50) => invoke<SearchDto>("search", { query, includeDone, limit }),
  counts: (today: string) => invoke<CountsDto>("counts", { today }),

  /** Fire the reminder again at `until` (local "YYYY-MM-DDTHH:MM"); the task's reminder codes do not change. */
  snoozeReminder: (project: string, no: number, code: string, until: string) =>
    invoke<null>("snooze_reminder", { project, no, code, until }),
  /** Reminders fired (or summarized at start-up) that the UI has not shown yet; taking them clears the list. */
  pendingReminders: () => invoke<PendingRemindersDto>("pending_reminders"),
  notificationPermission: () => invoke<NotificationPermission>("notification_permission"),
  requestNotificationPermission: () => invoke<NotificationPermission>("request_notification_permission"),
  showMainWindow: () => invoke<null>("show_main_window"),
};

const kinds: readonly AppErrorKind[] = ["not_found", "invalid", "io", "locked", "corrupt", "unsaved"];

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
