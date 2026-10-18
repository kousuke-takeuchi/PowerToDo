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
/** `parse_recurrence`: rrule and label are both null when the text is not a recurrence. */
export interface RecurrenceDto { rrule: string | null; label: string | null; }
/** `summarize_recurrence`: label is the RRULE itself when it has no short form; valid = the rule computes without error (a finished COUNT/UNTIL rule is valid; only an unreadable one is not). */
export interface RecurrenceLabelDto { label: string; valid: boolean; }

/**
 * A fired reminder (`reminder-fired` / `pending_reminders`). `at` is when it fired (local "YYYY-MM-DDTHH:MM"; the snooze time
 * for a snoozed one). `code` is the reminder code ("-0m", "-1d", "2026-10-20T09:00", …).
 * Contract: every item of `reminder-fired` also waits in the pending list. The UI calls `api.pendingReminders()` on mount and on
 * every `reminder-fired` event and shows what it returns; the call drains the list, so each reminder is shown once.
 */
export interface ReminderItem {
  project: string;
  no: number;
  title: string;
  code: string;
  at: string;
  due: string | null;
  dueTime: string | null;
}
export interface PendingRemindersDto { items: ReminderItem[]; }
/** OS notification permission. Desktop always reports "granted"; whether banners show is up to the OS settings. */
export type NotificationPermission = "granted" | "denied" | "prompt";

export type AppErrorKind = "not_found" | "invalid" | "io" | "locked" | "corrupt" | "unsaved";
export interface AppError { kind: AppErrorKind; message: string; }

/** `save-status` event payload. `project` is a project name or "_common". */
export type SaveState = "saving" | "saved" | "error";
export interface SaveStatus { project: string; state: SaveState; message?: string; }

/** `watchError`: watching the data folder could not start (the reason). Shown once by the main screen. */
export interface AppStateDto { dataDir: string | null; projects: ProjectSummary[]; inbox: string; warning?: string; watchError?: string; trayError?: string; }
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
/** `sync`: re-read after the sync downloaded the file (updated quietly, no flash). */
export type ChangeReason = "bulk" | "external" | "move" | "sync";

/** `projects-changed` payload. `commonReloaded`: the common workbook was re-read from its file in this batch. */
export interface ProjectsChanged {
  commonReloaded: boolean;
}

// ---- Phase 4: sync (src-tauri: commands/sync.rs, sync/engine.rs, sync/tailnet.rs) ----

/** 同期先。端末ごとの設定 (settings.json)。 */
export type SyncBackend = "none" | "nas" | "gdrive";
export interface SyncSettingsDto {
  backend: SyncBackend;
  /** 入力された NAS のフォルダ (`http://nas:5005/powertodo/`)。資格情報は含まない。 */
  nasUrl?: string;
  nasUser?: string;
  /** パスワードが OS のキーチェーン (または今回の起動中のメモリ) にある。値は返さない。 */
  nasPasswordSet: boolean;
  /** false のとき、パスワードはキーチェーンに保存できず再起動まで有効: 「パスワードを保存できません (再起動するまで有効)」。`nasPasswordSet` と合わせて判断する。 */
  passwordPersistent: boolean;
  googleEmail?: string;
  /** Google のリフレッシュトークンが保存されている (同期先が Google Drive のときだけ調べる)。 */
  googleLoggedIn: boolean;
  /** false のとき、ログイン情報はキーチェーンに保存できず再起動まで有効: 「ログイン情報を保存できません (再起動するまで有効)」。`googleLoggedIn` と合わせて判断する。 */
  googleTokenPersistent: boolean;
  /** このビルドに Google の OAuth クライアントが入っている。 */
  googleAvailable: boolean;
}
/** `sync-status` event / `sync_status` / `sync_now`. `lastSynced` is local time "YYYY-MM-DDTHH:MM:SS". */
export interface SyncStatusDto {
  state: SyncState;
  lastSynced?: string;
  /** 例外の文言 (offline / error)。日本語でそのまま表示してよい。 */
  message?: string;
  /** 前回の同期で次回に回したファイル数 (未保存・保留・失敗・名前の重なりなど)。 */
  pending: number;
  /** 空に見えた側。同期は止まり、`syncRecover` で選ぶまで再開しない。 */
  suspect?: "local" | "remote";
}
/** `sync-conflict` event: both sides changed `file`; the loser was saved as `conflictFile` (locally and on the target). */
export interface SyncConflict { file: string; conflictFile: string; }
/** `mirrorRemote`: このフォルダを同期先と同じにする。`mirrorLocal`: 同期先をこのフォルダと同じにする。 */
export type SyncRecoverMode = "mirrorRemote" | "mirrorLocal";
export type SyncRecoverOutcome = "done" | "suspect" | "offline" | "failed" | "interrupted" | "notRun";
export interface SyncRecoverDto { outcome: SyncRecoverOutcome; uploaded: number; downloaded: number; archived: number; failed: number; }

/** `done`: ログインした。`cancelled`: 「キャンセル」を押した。`denied`: Google の画面で許可しなかった。後ろの二つは失敗ではない。 */
export type GoogleLoginOutcome = "done" | "cancelled" | "denied";
export interface GoogleLoginDto { outcome: GoogleLoginOutcome; }
/** `revoked`: false のとき Google 側の取り消しはできなかった (この PC では、ログアウトは済んでいる)。 */
export interface GoogleLogoutDto { revoked: boolean; }

/**
 * Tailscale (サイドカー) の状態。`tailnet-status` event / `tailnet_status`.
 * `needs_login` の `loginUrl` はブラウザで開く (tauri-plugin-opener)。`starting` が 30 秒を超えたら「再試行」「状態を消す」を出す。
 */
export type TailnetStateName = "stopped" | "needs_login" | "needs_approval" | "starting" | "running" | "failed";
export interface TailnetStatus {
  state: TailnetStateName;
  name?: string;
  ip?: string;
  loginUrl?: string;
  error?: string;
  /** `starting` に入ってからの秒数。 */
  startedSecs?: number;
}

