import { invoke } from "@tauri-apps/api/core";
import type {
  AutostartDto,
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
  PlatformInfo,
  ProjectSummary,
  ProjectView,
  QuickAddOutcome,
  QuickAddResult,
  RecurrenceDto,
  RecurrenceLabelDto,
  SearchDto,
  SettingsDto,
  GoogleLoginDto,
  GoogleLogoutDto,
  SyncBackend,
  SyncRecoverDto,
  SyncRecoverMode,
  SyncSettingsDto,
  SyncStatusDto,
  TailnetStatus,
  TaskInput,
  TaskPatch,
  TodayViewDto,
  UpcomingDto,
  UpdateCheckDto,
  UpdateStatusDto,
} from "../types/model";

/** Typed wrapper over Tauri `invoke`. Command names and argument keys follow src-tauri/src/commands/mod.rs (camelCase of the Rust params). */
export const api = {
  /** The OS the app runs on (Rust `platform_info`). */
  platformInfo: () => invoke<PlatformInfo>("platform_info"),
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
  /** Drains the reminders fired (or summarized at start-up) that the UI has not shown yet. Call on mount and on every `reminder-fired`, and show the result. */
  pendingReminders: () => invoke<PendingRemindersDto>("pending_reminders"),
  notificationPermission: () => invoke<NotificationPermission>("notification_permission"),
  requestNotificationPermission: () => invoke<NotificationPermission>("request_notification_permission"),
  showMainWindow: () => invoke<null>("show_main_window"),

  // ---- Phase 4: sync ----
  syncSettings: () => invoke<SyncSettingsDto>("sync_settings"),
  /** Switching sends every file again at the next sync. A switch away from the NAS ends the Tailscale sidecar. Ask the user first. */
  setSyncBackend: (backend: SyncBackend) => invoke<SyncSettingsDto>("set_sync_backend", { backend }),
  tailnetStatus: () => invoke<TailnetStatus>("tailnet_status"),
  /** Starts the sidecar if needed and the interactive login; the URL arrives as a `tailnet-status` event (`needs_login`, `loginUrl`). Needs backend "nas". */
  tailnetLogin: () => invoke<null>("tailnet_login"),
  tailnetLogout: () => invoke<null>("tailnet_logout"),
  /** 「再試行」: restarts a stuck or failed sidecar and keeps its state folder (the login). Needs backend "nas". */
  tailnetRetry: () => invoke<null>("tailnet_retry"),
  /** Deletes the Tailscale state and starts over (the node needs a login again). */
  tailnetReset: () => invoke<null>("tailnet_reset"),
  /** 「確かめる」: finds the NAS in the tailnet, writes a file and reads it back. On success the details are saved and the sync starts. Rejects with a Japanese message. */
  nasCheck: (url: string, user: string, password: string) => invoke<null>("nas_check", { url, user, password }),
  /** Detaches the NAS and forgets the password (the address and user stay). */
  nasDisconnect: () => invoke<null>("nas_disconnect"),
  syncNow: () => invoke<SyncStatusDto>("sync_now"),
  syncStatus: () => invoke<SyncStatusDto>("sync_status"),
  /** After a `suspect` status: the user's choice, confirmed in a dialog first. */
  syncRecover: (mode: SyncRecoverMode) => invoke<SyncRecoverDto>("sync_recover", { mode }),
  /**
   * 「Google でログイン」: opens the browser and resolves when Google has come back (5 minutes at most). Needs backend "gdrive".
   * `cancelled` and `denied` are normal ends (resolved, not rejected). A second call while one waits rejects with a Japanese message.
   */
  googleLogin: () => invoke<GoogleLoginDto>("google_login"),
  /** 「キャンセル」 while `googleLogin` waits. Does nothing when none waits. */
  googleLoginCancel: () => invoke<null>("google_login_cancel"),
  /** Revokes (best effort; `revoked: false` when Google could not be reached), forgets the login and detaches the sync. The target stays Google Drive. */
  googleLogout: () => invoke<GoogleLogoutDto>("google_logout"),

  // ---- アプリの更新 ----
  updateStatus: () => invoke<UpdateStatusDto>("update_status"),
  /** 新しい版を探す。失敗は 日本語の文で reject する。インストール中は `available: false`。 */
  updateCheck: () => invoke<UpdateCheckDto>("update_check"),
  /**
   * 「今すぐ更新」: 同期を止め、保存して、ダウンロードして入れ替える。進み具合は `update-progress` event。
   * macOS / Linux は成功するとアプリが自分で再起動する (この Promise は戻らないことがある)。Windows はインストーラーがアプリを終わらせる。
   * 失敗 (保存できていない変更がある、ネットワークなど) は 日本語の文で reject する。データはそのまま。
   */
  updateInstall: () => invoke<null>("update_install"),
  setUpdateAutoCheck: (enabled: boolean) => invoke<null>("set_update_auto_check", { enabled }),
  /** ログイン時に起動するか (OS の登録の状態)。 */
  autostartStatus: () => invoke<AutostartDto>("autostart_status"),
  /** ログイン時に起動するかを OS に登録 / 解除する。返るのは OS の状態。失敗は日本語の文で reject する。 */
  setAutostart: (enabled: boolean) => invoke<AutostartDto>("set_autostart", { enabled }),
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
