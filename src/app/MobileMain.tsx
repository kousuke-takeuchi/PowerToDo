import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { api, errorMessage } from "../api/client";
import { onNotificationError, onOpenTask, onProjectChanged, onProjectsChanged, onWatchFailed, onWindowShown } from "../api/events";
import type { AppStateDto, Label, NotificationPermission, SearchHit, Task, TokenKind } from "../types/model";
import { FileText, Pencil, Plus } from "lucide-react";
import { BottomSheet, SheetCard, SheetRow } from "../views/mobile/BottomSheet";
import { DATE_SHEET_FORM, DateSheet } from "../views/mobile/DateSheet";
import { MobileBrowse } from "../views/mobile/MobileBrowse";
import { MobileLabelDetail, MobileLabels } from "../views/mobile/MobileLabels";
import { MobileProjectView } from "../views/mobile/MobileProjectView";
import { MobileQuickAddSheet } from "../views/mobile/MobileQuickAddSheet";
import { DATA_DIR_HINT, MobileSettings } from "../views/mobile/MobileSettings";
import { MobileSearch } from "../views/mobile/MobileSearch";
import { MobileShell } from "../views/mobile/MobileShell";
import { MobileTaskDetail } from "../views/mobile/MobileTaskDetail";
import { MobileToday } from "../views/mobile/MobileToday";
import { MobileUpcoming } from "../views/mobile/MobileUpcoming";
import { MoveSheet } from "../views/mobile/MoveSheet";
import { MobileDrawer, MobileMenuContext, type DrawerTarget } from "../views/mobile/MobileDrawer";
import { ProjectMenuSheet } from "../views/mobile/ProjectMenuSheet";
import { TEXT_SHEET_FORM, TextSheet } from "../views/mobile/TextSheet";
import { crossNavOf, projectOf, reduceNav, screenOf, type BrowseScreen, type MobileTab } from "./mobileNav";
import { useSystemTheme } from "./useSystemTheme";
import { ReminderSheet } from "../views/mobile/ReminderSheet";
import { PrioritySheet } from "../views/mobile/PrioritySheet";
import { LabelSheet } from "../views/mobile/LabelSheet";
import { TaskMenuSheet } from "../views/mobile/TaskMenuSheet";
import { Banners } from "./Banners";
import { MobileToast } from "../components/MobileToast";
import { pushUndo, undoSteps, undoText, type MobileUndo } from "./mobileUndo";
import { completedOf } from "./completionToast";
import { dateLabel } from "../mock/data";
import { useNowTime, useToday } from "./hooks";
import { useCalendarEvents } from "./useCalendarEvents";
import { useCalendarAccounts } from "./useCalendarAccounts";
import { eventDays, eventsOn, type ShownEvent } from "./calendarEvents";
import { OpenCalendarEventContext } from "./CalendarEventContext";
import { CalendarEventDetail } from "../components/CalendarEventDetail";
import { heldFileName, useExternalChanges, useExternalReadFailures } from "./useExternalChanges";
import { useCrossViews } from "./useCrossViews";
import { useProject } from "./useProject";
import { dateWords, projectWord, replaceWords, type InsertKind } from "./quickAddInsert";
import { useQuickAdd } from "./useQuickAdd";
import { remindersWithTime } from "./autoReminder";
import { useReminders } from "./useReminders";
import { useSaveErrors } from "./useSaveStatus";
import { initialMobileNav } from "./startView";
import { useSettingsPanes } from "./useSettingsPanes";
import { ViewOptionsCtx, useView, useViewOptionsStore } from "./view/ViewOptionsContext";
import { VIEW_SHEET_FORM, ViewSheet } from "../views/mobile/ViewSheet";
import { CalendarSheetHost } from "../views/mobile/CalendarSheetHost";
import { MobileDoc, MobileDocsList } from "../views/mobile/MobileDocs";
import { DetailSheet } from "../views/mobile/DetailSheet";
import { ScreenStack } from "../views/mobile/ScreenStack";
import { directionBetween, type ScreenDirection } from "../views/mobile/screenMotion";
import { useSearch } from "./useSearch";
import { useCommentCounts, useDialogComments } from "./useComments";
import { useSummaries } from "./useSummaries";
import type { RowContext } from "../views/mobile/rowProps";
import { useSync } from "./useSync";
import { AttachmentEnvContext } from "./attachments/env";
import { useAttachmentCounts, useAttachmentEnv, useNoteFiles } from "./useAttachments";
import type { SyncConflicts } from "./useSyncConflicts";
import { formatSynced, syncErrorText, targetName } from "./syncText";

type Flash = { text: string; tone: "error" | "info" };
const sheetTitle: Record<NonNullable<SheetState>["kind"], (s: NonNullable<SheetState>) => string> = {
  menu: (s) => (s.kind === "menu" ? s.task.title : ""),
  date: () => "日付",
  priority: () => "優先度",
  move: () => "移動",
  reschedule: () => "期限切れの日付",
};
const QA_PICKER_TITLE: Record<"reminder" | InsertKind, string> = { reminder: "リマインダー", date: "日付", priority: "優先度", project: "プロジェクト", label: "ラベル" };
/** 開いている下部シート。状態はここ (画面の子ではなく MobileMain) に持つ: 一覧の再読み込みや画面の差し替えで失わない。 */
type SheetState = { kind: "menu" | "date" | "priority" | "move"; task: Task } | { kind: "reschedule" } | null;

/**
 * iPhone の通常画面 (仕様 §4): 下部タブ (今日 / 近日 / 検索 / 一覧) + ドロワー + プロジェクト / ラベルの画面 + タスク詳細。
 * デスクトップの Main と同じフックにつなぐ。「一覧」のタブはドロワーを開き、選んだ受信トレイ / プロジェクト / ラベルを本文に出す。
 */
export function MobileMain(props: { app: AppStateDto; syncConflicts: SyncConflicts }) {
  // The drawer (spec 2026-11-22 §4): the tab screens' top bars read the opener from context.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  // The Google Calendar event whose detail is open (the sheet lives in MobileScreens' layers).
  const [calendarEvent, setCalendarEvent] = useState<ShownEvent | null>(null);
  // 表示の設定 (sort / group / filter of Today and Upcoming): the same rows of the common book as the desktop.
  const viewStore = useViewOptionsStore();
  return (
    <ViewOptionsCtx.Provider value={viewStore}>
      <MobileMenuContext.Provider value={openDrawer}>
        <OpenCalendarEventContext.Provider value={setCalendarEvent}>
          <MobileScreens {...props} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} calendarEvent={calendarEvent} closeCalendarEvent={() => setCalendarEvent(null)} />
        </OpenCalendarEventContext.Provider>
      </MobileMenuContext.Provider>
    </ViewOptionsCtx.Provider>
  );
}

function MobileScreens({ app, syncConflicts, drawerOpen, setDrawerOpen, calendarEvent, closeCalendarEvent }: { app: AppStateDto; syncConflicts: SyncConflicts; drawerOpen: boolean; setDrawerOpen: (open: boolean) => void; calendarEvent: ShownEvent | null; closeCalendarEvent: () => void }) {
  useSystemTheme();
  const today = useToday();
  useNowTime(); // re-render each minute so today's passed times turn red
  // Google Calendar events of the projects that have a calendar (spec 2026-11-27): display only.
  const cal = useCalendarEvents(today);
  const { errors: saveErrors } = useSaveErrors();

  // 画面: 下のタブと「閲覧」の中の画面の積み重ね (spec ④ iPhone §3.1-3.2)。起動直後は設定の「起動時に開く画面」(既定は今日)。
  const [nav, dispatchNav] = useReducer(reduceNav, app.startView, initialMobileNav);
  const screen = screenOf(nav);
  const settingsOpen = screen.kind === "settings";
  const goTab = (id: MobileTab) => dispatchNav({ type: "tab", tab: id });
  const push = (s: BrowseScreen) => dispatchNav({ type: "push", screen: s });
  const back = () => dispatchNav({ type: "back" });
  // プロジェクトの「…」(名前を変更 / 削除)
  // A section's 「…」: its menu, or its rename.
  const [sectionSheet, setSectionSheet] = useState<{ name: string; mode: "menu" | "rename" } | null>(null);
  const [projectSheet, setProjectSheet] = useState<"menu" | "rename" | "section" | "calendar" | null>(null);
  // 開いているタスク詳細 (全画面)。閉じると元の画面に戻る。
  // `parent`: opened from that task's detail (a subtask row); back goes there instead of the list.
  const [detail, setDetail] = useState<{ project: string; no: number; parent?: number } | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  // クイック追加の上に重ねるシート (リマインダー、チップの一覧: spec 2026-11-22 §1)
  const [qaPicker, setQaPicker] = useState<"reminder" | InsertKind | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("granted");

  const { summaries, displayName, refreshSummaries, loadDisplayName, counts } = useSummaries(app, today);

  const commentCounts = useCommentCounts(summaries.map((s) => s.name));
  const attachmentCounts = useAttachmentCounts(summaries.map((s) => s.name));
  const rowContext = useMemo<Omit<RowContext, "today">>(
    () => ({ inbox: app.inbox, colors: Object.fromEntries(summaries.map((s) => [s.name, s.color])), comments: commentCounts, attachments: attachmentCounts }),
    [app.inbox, summaries, commentCounts, attachmentCounts],
  );

  const sync = useSync({ active: settingsOpen, onNotice: (text, tone) => setFlash({ text, tone }) });
  const syncStatus = sync.status;
  const syncState = syncStatus?.state ?? "off";
  const syncClickable = syncState === "error" && !syncStatus?.suspect && !syncStatus?.authRejected;
  const [dismissedSyncError, setDismissedSyncError] = useState<string | null>(null);
  useEffect(() => {
    if (syncState !== "error") setDismissedSyncError(null);
  }, [syncState]);
  // ヘッダーの同期アイコン: エラーのうち「今すぐ同期」で直らないもの (片側が空 / 認証の拒否) は設定の同期を開く。それ以外は今すぐ同期。
  const syncNeedsSettings = !!syncStatus?.suspect || (syncState === "error" && !!syncStatus?.authRejected);
  const headerSync = () => {
    if (syncNeedsSettings) push({ kind: "settings" });
    else if (syncState !== "syncing") void sync.syncNow(true);
  };
  const syncErrorMessage =
    syncState === "error" && !syncStatus?.suspect && syncStatus?.message && syncStatus.message !== dismissedSyncError ? syncStatus.message : null;

  const viewNav = crossNavOf(nav);
  const listProject = screen.kind === "inbox" || screen.kind === "project";
  const navCurrent = projectOf(nav, app.inbox);
  // タスク詳細を開くあいだは、そのプロジェクトを読む
  const current = detail ? detail.project : navCurrent;

  const showError = useCallback((e: unknown) => setFlash({ text: errorMessage(e), tone: "error" }), []);
  const showWarnings = useCallback((w: string[]) => setFlash({ text: w.join(" / "), tone: "error" }), []);
  const p = useProject(current, { onMutated: refreshSummaries, onWarnings: showWarnings });
  const view = p.view && p.view.project.name === current ? p.view : null;
  const ext = useExternalChanges(showError);
  const readFailures = useExternalReadFailures();

  const { todayData, lastUpcoming, upcomingData, setUpDays, labelData, labelsData, cross, refreshAll, labelName } = useCrossViews({
    nav: viewNav,
    today,
    inbox: app.inbox,
    showError,
    showWarnings,
    refreshSummaries,
  });

  const search = useSearch(screen.kind === "search");
  const calAccounts = useCalendarAccounts(screen.kind === "settings", () => void cal.refresh(true));
  const settingsPanes = useSettingsPanes(settingsOpen, { onDataDirChanged: () => undefined, onDisplayNameChanged: () => loadDisplayName() });
  // 引っ張って更新: 同期してから、見えている一覧を読み直す。同期先が無いときは同期は何もせず、読み直しだけ。
  const pullRefresh = async () => {
    await sync.syncNow(true);
    void cal.refresh(true);
    refreshAll();
  };
  // 設定を開くとき、OS の通知の許可を読む
  useEffect(() => {
    if (!settingsOpen) return;
    api
      .notificationPermission()
      .then(setPermission)
      .catch(() => undefined);
  }, [settingsOpen]);
  const toggleNotifications = (enabled: boolean) => {
    settingsPanes.notifications.onToggle?.(enabled);
    // まだ聞いていないときは、オンにしたところで許可を求める
    if (enabled && permission === "prompt") requestPermission();
  };
  const requestPermission = () => {
    api
      .requestNotificationPermission()
      .then(setPermission)
      .catch(() => undefined);
  };

  const { qa, openQuickAdd, openQuickAddAt, openQuickAddWith, setPlace, closeQuickAdd, setText, setReminders, submit, tokens, qaProject, parsed } = useQuickAdd({ p, current: navCurrent, setFlash, autoReminder: true });
  // The section / parent shows on the project chip while the task still goes to this project.
  const qaPlaced = qaProject === navCurrent ? qa.place : undefined;
  const qaParent = qaPlaced?.parentNo !== undefined ? view?.tasks.find((t) => t.no === qaPlaced.parentNo) : undefined;
  const qaProjectName = (qaProject === app.inbox ? "受信トレイ" : qaProject) + (qaParent ? ` / ${qaParent.title}` : qaPlaced?.section ? ` / ${qaPlaced.section}` : "");

  useEffect(() => {
    if (!qa.open) setQaPicker(null);
  }, [qa.open]);
  // A picked value rewrites the words of its kind in the field (the field stays the source, as typed words).
  const rewrite = (kinds: TokenKind[], words: string[]) => setText(replaceWords(qa.text, parsed?.spans ?? [], kinds, words));

  // ラベルのシートに並べる、ストアにあるラベル (詳細を開いたとき読む)
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const detailOpen = detail !== null;
  // The task detail's label sheet and the quick add's label picker list them.
  const labelsWanted = detailOpen || qa.open || screen.kind === "today";
  useEffect(() => {
    if (!labelsWanted) return;
    let cancelled = false;
    api
      .labels()
      .then((d) => {
        if (!cancelled) setAllLabels(d.labels);
      })
      // 読めなかったことを知らせる (シートの「ラベルがありません」は、本当に無いときだけの文言)
      .catch((e) => {
        if (!cancelled) showError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [labelsWanted, showError]);

  // ---- 行の操作 (スワイプ / 長押しのシート)。開いているプロジェクトの行は useProject、横断ビューの行は cross (操作のあと refreshAll) ----
  const closeSheet = () => setSheet(null);
  const inCurrent = (t: Task) => (listProject || !!detail) && t.project === current;
  // Spec ④ iPhone §5.4: the toast with 「元に戻す」 after completing, changing a date, or moving.
  const [undo, setUndo] = useState<{ u: MobileUndo; id: number } | null>(null);
  const undoId = useRef(0);
  const offer = (u: MobileUndo) => setUndo((cur) => ({ u: pushUndo(cur?.u ?? null, u), id: ++undoId.current }));
  const onScreen = (project: string) => (listProject || !!detail) && project === current;
  const runUndo = async (u: MobileUndo) => {
    setUndo(null);
    try {
      for (const s of undoSteps(u)) {
        if (s.op === "complete") await (onScreen(s.project) ? p.completeTask(s.no, false, true) : cross.setDone(s.project, s.no, false, true));
        else if (s.op === "update") await (onScreen(s.project) ? p.updateTask(s.no, s.patch) : api.updateTask(s.project, s.no, s.patch));
        else if (s.op === "run") s.run();
        else await api.moveTask(s.project, s.no, s.toProject, s.toSection);
      }
    } catch (e) {
      showError(e);
    }
    if (listProject || detail) void p.reload().catch(() => undefined);
    refreshAll();
    void refreshSummaries();
  };
  // The open task's comments and description files (spec 添付 §6). A file taken off a description can be put back from the toast.
  const taskComments = useDialogComments(detail, showError);
  const taskNote = useNoteFiles(detail, showError, (text, _action, run) => offer({ kind: "run", text, run }));
  const attachmentEnv = useAttachmentEnv(!sync.status || sync.status.state === "syncing", showError);
  const offerDate = (entries: { project: string; no: number; due?: string; dueTime?: string }[], date: string | null) =>
    offer({ kind: "date", entries: entries.map((t) => ({ project: t.project, no: t.no, before: { due: t.due ?? null, dueTime: t.dueTime ?? null } })), label: date ? (dateLabel(date, today)?.label ?? date) : null });
  const offerDone = (t: Task) => offer({ kind: "complete", entries: [completedOf(t)] });
  const setDue = (t: Task, date?: string, time?: string | null) => {
    // A time gives the task the reminder 「時刻ちょうど」 (spec 2026-11-27), unless it has reminders already.
    const reminders = date ? remindersWithTime(t.reminders, time) : undefined;
    if (inCurrent(t)) void p.updateTask(t.no, { due: date ?? null, dueTime: date ? time : null, ...(reminders ? { reminders } : {}) }).then((ok) => ok && offerDate([t], date ?? null));
    else void cross.setDue(t, date ?? null, time, reminders).then((ok) => ok && offerDate([t], date ?? null));
  };
  const setPriority = (t: Task, priority: 1 | 2 | 3 | 4) => {
    if (inCurrent(t)) void p.updateTask(t.no, { priority });
    else void cross.setPriority(t, priority);
  };
  const removeTask = (t: Task) => {
    if (detail && detail.project === t.project && detail.no === t.no) setDetail(null);
    if (inCurrent(t)) void p.deleteTask(t.no);
    else void cross.remove(t);
  };
  const moveTask = async (t: Task, toProject: string, toSection: string | null) => {
    try {
      const out = await api.moveTask(t.project, t.no, toProject, toSection);
      const no = out.no; // another project renumbers the subtree; the outcome carries the root's new No.
      offer({ kind: "move", to: { project: toProject, no }, back: { project: t.project, section: t.category }, toName: toProject === app.inbox ? "受信トレイ" : toProject });
    } catch (e) {
      showError(e);
    }
    if (listProject || detail) void p.reload().catch(() => undefined);
    refreshAll();
  };
  /** The task detail's 「プロジェクト」 (2026-11-22): the detail follows the task to its new place (another project renumbers it). */
  const moveOpenTask = async (t: Task, toProject: string, toSection: string | null) => {
    try {
      const out = await api.moveTask(t.project, t.no, toProject, toSection);
      setDetail({ project: toProject, no: out.no });
      offer({ kind: "move", to: { project: toProject, no: out.no }, back: { project: t.project, section: t.category }, toName: toProject === app.inbox ? "受信トレイ" : toProject });
      // Same project: re-read it here (another project is read when the detail switches to it).
      if (toProject === t.project) void p.reload().catch(() => undefined);
    } catch (e) {
      showError(e);
    }
    refreshAll();
    void refreshSummaries();
  };
  /** 「タスクを複製」 (the long-press menu): the copy is added next to the task. */
  const duplicateTask = (t: Task) =>
    void api.duplicateTask(t.project, t.no).then(
      () => {
        if (listProject || detail) void p.reload().catch(() => undefined);
        refreshAll();
        void refreshSummaries();
        setFlash({ text: "タスクを複製しました", tone: "info" });
      },
      showError,
    );
  const renameProject = async (name: string) => {
    const from = navCurrent;
    try {
      const r = await api.renameProject(from, name);
      dispatchNav({ type: "renamed", from, to: r.name });
      await refreshSummaries();
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh(); // held projects are held again under the new name (as desktop)
    }
  };
  const deleteProject = async () => {
    const name = navCurrent;
    try {
      await api.deleteProject(name);
      dispatchNav({ type: "removed", project: name });
      await refreshSummaries();
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh();
    }
  };
  const rowOps = { onSwipeDate: (t: Task) => setSheet({ kind: "date", task: t }), onTaskMenu: (t: Task) => setSheet({ kind: "menu", task: t }) };

  /** タスクの詳細を開く (別のプロジェクトのタスクでも、元の画面を保ったまま)。 */
  const openTaskAt = (project: string, no: number) => {
    if (project !== app.inbox && !summaries.some((s) => s.name === project)) {
      setFlash({ text: "タスクが見つかりません", tone: "error" });
      return;
    }
    closeQuickAdd();
    setDetail({ project, no });
  };
  const openCross = (t: Task) => openTaskAt(t.project, t.no);

  // 詳細を開いた先にタスクが無い (通知を受けてから消えた) / 読み込めない: 閉じて知らせる
  useEffect(() => {
    if (!detail) return;
    if (p.error) {
      setDetail(null);
      return;
    }
    if (view && !view.tasks.some((t) => t.no === detail.no)) {
      setDetail(null);
      setFlash({ text: "タスクが見つかりません", tone: "error" });
    }
  }, [detail, view, p.error]);

  // ---- リマインダー・バックエンドのイベント (Main と同じ) ----
  const reminders = useReminders({
    onError: showError,
    onInfo: (text) => setFlash({ text, tone: "info" }),
    complete: (project, no) => ((listProject || detail) && project === current ? p.completeTask(no, true) : cross.setDone(project, no, true)),
    openTask: (project, no) => openTaskAt(project, no),
  });
  const wired = useRef({ openTaskAt, refreshAll, fetchPending: reminders.fetchPending, removeTask: reminders.removeTask });
  wired.current = { openTaskAt, refreshAll, fetchPending: reminders.fetchPending, removeTask: reminders.removeTask };
  useEffect(() => {
    const offs = [
      onOpenTask((project, no) => {
        wired.current.removeTask(project, no);
        wired.current.openTaskAt(project, no);
      }),
      onNotificationError((text) => setFlash({ text, tone: "error" })),
      // アプリに戻ったとき: 離れている間に変わった分 (同期、発火したリマインダー) を取り直す
      onWindowShown(() => {
        wired.current.refreshAll();
        void wired.current.fetchPending();
      }),
      onProjectChanged((name, reason) => {
        if (reason === "external") setFlash({ text: `「${name}」の変更を取り込みました`, tone: "info" });
      }),
      onProjectsChanged(() => {
        void refreshSummaries();
        loadDisplayName();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [refreshSummaries, loadDisplayName]);
  const watchFailed = useCallback((m: string) => setFlash({ text: `ファイルの変更監視を開始できません (${m})`, tone: "error" }), []);
  useEffect(() => {
    if (app.watchError) watchFailed(app.watchError);
  }, [app.watchError, watchFailed]);
  useEffect(() => onWatchFailed(watchFailed), [watchFailed]);
  useEffect(() => {
    if (flash?.tone !== "info") return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  const drawerGo = (to: DrawerTarget) => {
    setDrawerOpen(false);
    if (to.kind === "inbox" || to.kind === "today" || to.kind === "upcoming") goTab(to.kind);
    else dispatchNav({ type: "open", screen: to.kind === "project" ? { kind: "project", name: to.name } : { kind: to.kind } });
  };
  const drawerActive: DrawerTarget | undefined =
    screen.kind === "project"
      ? { kind: "project", name: screen.name }
      : screen.kind === "docs" || screen.kind === "doc"
        ? { kind: "project", name: screen.project }
        : screen.kind === "label"
          ? { kind: "labels" }
          : screen.kind === "browse"
            ? undefined
            : { kind: screen.kind };
  // 表示のシート (右上の「…」): Today / Upcoming.
  const [viewSheet, setViewSheet] = useState<"today" | "upcoming" | "project" | null>(null);
  const [todayView, setTodayView] = useView("today");
  const [upcomingView, setUpcomingView] = useView("upcoming");
  // The open project's (or the inbox's) own 表示, keyed by its name like the desktop's.
  const [projectView, setProjectView] = useView("project", navCurrent);
  const arrangeCtx = { today, weekStart: settingsPanes.datetime.weekStart, labelOrder: allLabels.map((l) => l.name), projectOrder: summaries.map((s) => s.name) };
  const reveal = () => setFlash({ text: "「ファイル」アプリの PowerToDo フォルダで確認できます", tone: "info" });
  // On 今日 a new task starts dated today, on 近日 on the day at the top of the list (as Todoist): the field opens with the date word.
  const [upcomingDay, setUpcomingDay] = useState<string | null>(null);
  const fab =
    screen.kind === "today"
      ? () => openQuickAddWith("今日 ")
      : screen.kind === "upcoming"
        ? () => openQuickAddWith(`${dateWords(upcomingDay && upcomingDay >= today ? upcomingDay : today, undefined, today).join(" ")} `)
        : openQuickAdd;
  const header = { fill: true as const, onFab: fab, onTabChange: goTab, today };

  // ---- 層: 帯 + クイック追加 + ドロワー ----
  const invalidCount = listProject && !p.error && view ? view.invalidRows.length : 0;
  const banner = (
    <Banners
          narrow
          reminders={{
            items: reminders.items,
            today,
            notifyTime: reminders.notifyTime,
            onDone: (item) => void reminders.done(item),
            onSnooze: (item, until) => void reminders.snooze(item, until),
            onOpen: reminders.open,
            onDismiss: reminders.dismiss,
            onDismissAll: reminders.clear,
          }}
          saveErrors={saveErrors}
          onRetrySave={(project) => void api.retrySave(project).catch(() => undefined)}
          readFailures={readFailures}
          held={ext.held}
          heldFileName={heldFileName}
          onResolve={(project, choice) => void ext.resolve(project, choice)}
          invalidCount={invalidCount}
          onReveal={reveal}
          onReload={() => void p.reload().catch(() => undefined)}
          notice={p.notice}
          onClearNotice={p.clearNotice}
          flash={flash}
          onClearFlash={() => setFlash(null)}
          sync={{
            suspect: syncStatus?.suspect
              ? {
                  side: syncStatus.suspect,
                  target: targetName(sync.settings?.backend),
                  busy: sync.busy === "recover",
                  error: sync.recoverError,
                  onRecover: (mode) => void sync.recover(mode),
                }
              : undefined,
            errorMessage: syncErrorMessage,
            onDismissError: () => setDismissedSyncError(syncStatus?.message ?? null),
            conflicts: syncConflicts.conflicts,
            onOpenConflict: reveal,
            onDismissConflict: syncConflicts.dismissConflict,
          }}
        />
  );
  // ---- タスク詳細 (下からのポップアップ, spec 2026-11-28) ----
  // The list stays under it. The card keeps its last content while it slides away.
  const openTask = detail ? view?.tasks.find((t) => t.no === detail.no) : undefined;
  const closeDetail = () => setDetail(detail?.parent !== undefined ? { project: detail.project, no: detail.parent } : null);
  const lastDetail = useRef<React.ReactNode>(null);
  if (detail) {
    lastDetail.current =
      !view || !openTask ? (
        <div style={{ padding: "var(--space-6) 16px", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>読み込み中…</div>
      ) : (
        <AttachmentEnvContext.Provider value={attachmentEnv}>
              <MobileTaskDetail
                key={`${detail.project}/${openTask.no}`}
                live
                fill
                popup
                today={today}
                task={openTask}
                subtasks={view.tasks.filter((t) => t.parentNo === openTask.no).sort((a, b) => a.order - b.order)}
                project={view.project}
                section={openTask.category ?? undefined}
                onBack={closeDetail}
                onOpenSubtask={(t) => setDetail({ project: detail.project, no: t.no, parent: openTask.no })}
                onToggleDone={(done) =>
                  void p.completeTask(openTask.no, done).then((ok) => {
                    if (ok && done) offerDone(openTask);
                    refreshAll();
                  })
                }
                onToggleSubtask={(t, done) =>
                  void p.completeTask(t.no, done).then((ok) => {
                    if (ok && done) offerDone(t);
                    refreshAll();
                  })
                }
                onChange={(patch) =>
                  void p.updateTask(openTask.no, "dueTime" in patch && !("reminders" in patch) ? { ...patch, ...(remindersWithTime(openTask.reminders, patch.dueTime) ? { reminders: remindersWithTime(openTask.reminders, patch.dueTime) } : {}) } : patch).then((ok) => {
                    if (ok && "due" in patch) offerDate([openTask], patch.due ?? null);
                    refreshAll();
                  })
                }
                onAddSubtask={(title) => void p.addSubtask(openTask.no, title).then(refreshAll)}
                onDelete={() => {
                  setDetail(null);
                  void p.deleteTask(openTask.no).then(refreshAll);
                }}
                onDuplicate={() =>
                  void api.duplicateTask(openTask.project, openTask.no).then(
                    () => {
                      void p.reload().catch(() => undefined);
                      refreshAll();
                      void refreshSummaries();
                      setFlash({ text: "タスクを複製しました", tone: "info" });
                    },
                    showError,
                  )
                }
                labels={allLabels}
                onParseRecurrence={api.parseRecurrence}
                comments={taskComments.comments}
                commentsFailed={taskComments.failed}
                me={displayName}
                onAddComment={taskComments.add}
                onEditComment={taskComments.edit}
                onDeleteComment={taskComments.remove}
                onAttachComment={taskNote.store}
                noteFiles={taskNote.files}
                onAttachNote={taskNote.attach}
                onDetachNote={(id) => void taskNote.detach(id)}
                onMove={openTask.parentNo === undefined ? (project, section) => void moveOpenTask(openTask, project, section) : undefined}
                projects={summaries}
                sections={view.sections}
              />
              </AttachmentEnvContext.Provider>
      );
  }
  const detailLayer = (
    <DetailSheet open={detail !== null} onClose={closeDetail}>
      {lastDetail.current}
    </DetailSheet>
  );
  const layers = (
    <>
      {detailLayer}
      <MobileDrawer
        open={drawerOpen && !detail}
        onClose={() => setDrawerOpen(false)}
        displayName={displayName}
        projects={summaries}
        counts={counts}
        active={drawerActive}
        syncState={syncState}
        lastSyncedAt={formatSynced(syncStatus?.lastSynced)}
        syncOffText="同期オフ"
        syncErrorText={syncErrorText(syncStatus, syncClickable)}
        onSync={() => {
          setDrawerOpen(false);
          if (syncState === "off") dispatchNav({ type: "open", screen: { kind: "settings" } });
          else headerSync();
        }}
        onGo={drawerGo}
      />
      <AnimatePresence initial={false}>
        {qa.open && (
          <MobileQuickAddSheet
            key="quickAdd"
            fill
            tokens={tokens}
            text={qa.text}
            onTextChange={setText}
            onSubmit={(t) => void submit(t).then(refreshAll)}
            busy={qa.busy}
            error={qa.error}
            onPick={setQaPicker}
            reminders={qa.reminders}
            onPickReminder={() => setQaPicker("reminder")}
            projectName={qaProjectName}
            covered={qaPicker !== null}
            onClose={closeQuickAdd}
          />
        )}
        {undo && <MobileToast key="undo" id={undo.id} text={undoText(undo.u)} onAction={() => void runUndo(undo.u)} onClose={() => setUndo(null)} />}
      </AnimatePresence>
      <BottomSheet
        fill
        size={qaPicker === "project" || qaPicker === "date" ? "large" : "auto"}
        confirmForm={qaPicker === "date" ? DATE_SHEET_FORM : undefined}
        open={qa.open && qaPicker !== null}
        title={qaPicker === null ? undefined : QA_PICKER_TITLE[qaPicker]}
        onClose={() => setQaPicker(null)}
      >
        {qaPicker === "reminder" && <ReminderSheet value={qa.reminders} onChange={setReminders} />}
        {qaPicker === "date" && (
          <DateSheet
            value={parsed?.due ?? undefined}
            time={parsed?.dueTime ?? undefined}
            today={today}
            // 日付なし clears the recurrence too: a recurrence alone would set the date again.
            onApply={(v) => rewrite(v.date ? ["date", "time"] : ["date", "time", "recurrence"], dateWords(v.date, v.time, today))}
            noRepeat
            onClose={() => setQaPicker(null)}
          />
        )}
        {qaPicker === "priority" && (
          <PrioritySheet value={parsed?.priority ?? 4} onChange={(v) => rewrite(["priority"], v === 4 ? [] : [`p${v}`])} onClose={() => setQaPicker(null)} />
        )}
        {qaPicker === "project" && (
          <MoveSheet
            projects={summaries}
            sections={qaProject === navCurrent && view ? view.sections : []}
            current={{ project: qaProject, section: qaPlaced?.section ?? null }}
            onMove={(project, section) => {
              rewrite(["project"], project === navCurrent ? [] : [projectWord(project)]);
              // A section only exists in this project; picking anything clears the parent.
              setPlace(project === navCurrent && section ? { section } : undefined);
            }}
            onClose={() => setQaPicker(null)}
          />
        )}
        {qaPicker === "label" && <LabelSheet labels={allLabels} value={parsed?.labels ?? []} onChange={(names) => rewrite(["label"], names.map((n) => `@${n}`))} />}
      </BottomSheet>
      <BottomSheet fill size="large" open={calendarEvent !== null} title="予定" onClose={closeCalendarEvent}>
        {calendarEvent && <CalendarEventDetail event={calendarEvent} today={today} />}
      </BottomSheet>
      <BottomSheet fill size="large" confirmForm={VIEW_SHEET_FORM} open={viewSheet !== null} title="表示" onClose={() => setViewSheet(null)}>
        {viewSheet !== null && (
          <ViewSheet
            // Each opening starts from the saved options (the sheet keeps a draft until the red check).
            key={`${viewSheet}:${navCurrent}`}
            screen={viewSheet}
            options={viewSheet === "today" ? todayView : viewSheet === "upcoming" ? upcomingView : projectView}
            onApply={viewSheet === "today" ? setTodayView : viewSheet === "upcoming" ? setUpcomingView : setProjectView}
            onClose={() => setViewSheet(null)}
          />
        )}
      </BottomSheet>
      <BottomSheet
        fill
        confirmForm={sectionSheet?.mode === "rename" ? TEXT_SHEET_FORM : undefined}
        open={sectionSheet !== null}
        title={sectionSheet?.mode === "rename" ? "名前を変更" : sectionSheet?.name}
        onClose={() => setSectionSheet(null)}
      >
        {sectionSheet?.mode === "menu" && (
          <SheetCard label="セクションの操作">
            <SheetRow icon={<Pencil size={18} />} label="名前を変更" onClick={() => setSectionSheet({ name: sectionSheet.name, mode: "rename" })} />
            <SheetRow
              icon={<FileText size={18} />}
              label="ドキュメント"
              onClick={() => {
                const name = sectionSheet.name;
                setSectionSheet(null);
                push({ kind: "docs", project: navCurrent, section: name });
              }}
            />
            <SheetRow
              icon={<Plus size={18} />}
              label="タスクを追加"
              onClick={() => {
                const name = sectionSheet.name;
                setSectionSheet(null);
                openQuickAddAt({ section: name });
              }}
            />
          </SheetCard>
        )}
        {sectionSheet?.mode === "rename" && (
          <TextSheet
            label="セクション名"
            value={sectionSheet.name}
            onSave={(v) => {
              const t = v.trim();
              if (t && t !== sectionSheet.name) void p.renameSection(sectionSheet.name, t);
            }}
            onClose={() => setSectionSheet(null)}
          />
        )}
      </BottomSheet>
      <BottomSheet
        fill
        confirmForm={projectSheet === "rename" || projectSheet === "section" ? TEXT_SHEET_FORM : undefined}
        size={projectSheet === "calendar" ? "large" : "auto"}
        open={projectSheet !== null}
        title={projectSheet === "rename" ? "名前を変更" : projectSheet === "section" ? "セクションを追加" : projectSheet === "calendar" ? "Google カレンダー" : navCurrent === app.inbox ? "受信トレイ" : navCurrent}
        onClose={() => setProjectSheet(null)}
      >
        {projectSheet === "menu" && (
          <ProjectMenuSheet
            project={navCurrent}
            onAddSection={() => setProjectSheet("section")}
            onCalendar={() => setProjectSheet("calendar")}
            onDocs={() => {
              setProjectSheet(null);
              push({ kind: "docs", project: navCurrent, section: null });
            }}
            onRename={navCurrent === app.inbox ? undefined : () => setProjectSheet("rename")}
            onDelete={navCurrent === app.inbox ? undefined : () => void deleteProject()}
            onClose={() => setProjectSheet(null)}
          />
        )}
        {projectSheet === "calendar" && (
          <CalendarSheetHost project={navCurrent} current={cal.links[navCurrent] ?? []} onChanged={() => void cal.refresh(true)} />
        )}
        {projectSheet === "section" && (
          <TextSheet
            label="セクション名"
            value=""
            placeholder="セクション名"
            onSave={(v) => {
              const t = v.trim();
              if (t) void p.addSection(t);
            }}
            onClose={() => setProjectSheet(null)}
          />
        )}
        {projectSheet === "rename" && (
          <TextSheet
            label="プロジェクト名"
            value={navCurrent}
            onSave={(v) => {
              const t = v.trim();
              if (t && t !== navCurrent) void renameProject(t);
            }}
            onClose={() => setProjectSheet(null)}
          />
        )}
      </BottomSheet>
      <BottomSheet
        fill
        size={sheet?.kind === "move" || sheet?.kind === "date" || sheet?.kind === "reschedule" ? "large" : "auto"}
        confirmForm={sheet?.kind === "date" || sheet?.kind === "reschedule" ? DATE_SHEET_FORM : undefined}
        open={sheet !== null}
        title={sheet === null ? undefined : sheetTitle[sheet.kind](sheet)}
        onClose={closeSheet}
      >
        {sheet?.kind === "menu" && (
          <TaskMenuSheet
            task={sheet.task}
            onDate={() => setSheet({ kind: "date", task: sheet.task })}
            onPriority={() => setSheet({ kind: "priority", task: sheet.task })}
            onMove={sheet.task.parentNo === undefined ? () => setSheet({ kind: "move", task: sheet.task }) : undefined}
            onDuplicate={() => duplicateTask(sheet.task)}
            onDelete={() => removeTask(sheet.task)}
            onClose={closeSheet}
          />
        )}
        {sheet?.kind === "date" && (
          <DateSheet value={sheet.task.due} time={sheet.task.dueTime} today={today} noRepeat onApply={(v) => setDue(sheet.task, v.date, v.time ?? null)} onClose={closeSheet} />
        )}
        {sheet?.kind === "priority" && <PrioritySheet value={sheet.task.priority} onChange={(v) => setPriority(sheet.task, v)} onClose={closeSheet} />}
        {sheet?.kind === "move" && (
          <MoveSheet
            projects={summaries}
            sections={view && view.project.name === sheet.task.project ? view.sections : []}
            current={{ project: sheet.task.project, section: sheet.task.category }}
            onMove={(project, section) => void moveTask(sheet.task, project, section)}
            onClose={closeSheet}
          />
        )}
        {sheet?.kind === "reschedule" && (
          <DateSheet
            dateOnly
            today={today}
            onApply={(v) => {
              if (v.date) {
                const before = todayData.data?.overdue ?? [];
                void api.rescheduleOverdue(today, v.date).then(() => offerDate(before, v.date!), showError).finally(refreshAll);
              }
            }}
            onClose={closeSheet}
          />
        )}
      </BottomSheet>
    </>
  );

  /** 読み込み中 / 失敗の本文 (タブとヘッダーはそのまま)。 */
  const frame = (title: string, text: string, tone: "muted" | "danger" = "muted", retry?: () => void) => (
    <MobileShell
      fill
      title={title}
      onBack={nav.tab === "browse" && nav.browse.length > 0 ? back : undefined}
      tab={nav.tab}
      onTabChange={goTab}
      today={today}
      banner={banner}
          >
      <div
        role={tone === "danger" ? "alert" : undefined}
        style={{ padding: "var(--space-6) 16px", textAlign: "center", fontSize: 14, color: tone === "danger" ? "var(--color-danger)" : "var(--color-text-secondary)" }}
      >
        {text}
        {retry && (
          <div style={{ paddingTop: "var(--space-3)" }}>
            <button
              type="button"
              onClick={retry}
              style={{ padding: "8px 12px", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}
            >
              再試行
            </button>
          </div>
        )}
      </div>
    </MobileShell>
  );

  // The way the screen arrives: from the change of the navigation since the last render (kept in refs so a re-render does not reset it).
  const prevNav = useRef(nav);
  const directionRef = useRef<ScreenDirection>("none");
  if (prevNav.current !== nav) {
    directionRef.current = directionBetween(prevNav.current, nav);
    prevNav.current = nav;
  }
  const screenDirection = directionRef.current;
  const screenKey = `${nav.tab}:${screen.kind}:${"name" in screen ? screen.name : ""}`;

  const renderScreen = (): React.ReactElement => {
  // ---- The screen to show; `renderScreen()` is what the ScreenStack animates between ----
  if (settingsOpen && !detail) {
    return (
      <MobileSettings
        fill
        banner={banner}
                onBack={back}
        onTabChange={goTab}
        today={today}
        sync={sync.pane}
        calendar={{ accounts: calAccounts.accounts, busy: calAccounts.busy, waiting: calAccounts.waiting, error: calAccounts.error, onAdd: () => void calAccounts.add(), onCancel: calAccounts.cancel, onLogout: (e) => void calAccounts.logout(e) }}
        notifications={{ ...settingsPanes.notifications, permission }}
        onToggleNotifications={toggleNotifications}
        onRequestPermission={requestPermission}
        general={settingsPanes.general}
        displayName={settingsPanes.account.displayName}
        onDisplayName={settingsPanes.account.onSaveDisplayName}
        displayNameBusy={settingsPanes.account.busy}
        displayNameError={settingsPanes.account.error}
        dataDirHint={DATA_DIR_HINT}
      />
    );
  }

  // ---- 本文 ----
  if (screen.kind === "today") {
    const d = todayData.data;
    if (todayData.error) return frame("今日", todayData.error, "danger");
    if (!d) return frame("今日", "読み込み中…");
    return (
      <MobileToday
        rowContext={rowContext}
        live
        {...header}
        banner={banner}
        onRefresh={pullRefresh}
        overdue={d.overdue}
        todays={d.today}
        onToggleDone={(t, done) => void cross.toggleDone(t, done).then((ok) => ok && done && offerDone(t))}
        onOpenTask={openCross}
        onReschedule={() => setSheet({ kind: "reschedule" })}
        view={todayView}
        arrangeCtx={arrangeCtx}
        events={eventsOn(cal.events, today)}
        onViewMenu={() => setViewSheet("today")}
        onReorderToday={(keys, rescheduled) =>
          void (rescheduled ? api.updateTask(rescheduled.project, rescheduled.no, { due: today }) : Promise.resolve())
            .then(() =>
              api.setTodayOrder(
                today,
                keys.map((k): [string, number] => [k.slice(0, k.lastIndexOf("/")), Number(k.slice(k.lastIndexOf("/") + 1))]),
              ),
            )
            .then(() => {
              if (rescheduled) offerDate([rescheduled], today);
              refreshAll();
            }, showError)
        }
        {...rowOps}
              />
    );
  }
  if (screen.kind === "upcoming") {
    const d = lastUpcoming.current;
    if (upcomingData.error) return frame("近日", upcomingData.error, "danger");
    if (!d) return frame("近日", "読み込み中…");
    return (
      <MobileUpcoming
        rowContext={rowContext}
        live
        {...header}
        banner={banner}
        onRefresh={pullRefresh}
        tasks={d.days.flatMap((g) => g.tasks)}
        onToggleDone={(t, done) => void cross.toggleDone(t, done).then((ok) => ok && done && offerDone(t))}
        onOpenTask={openCross}
        onExtend={() => setUpDays((n) => Math.min(91, n + 7))}
        onMoveToDay={(t, date) => setDue(t, date, t.dueTime ?? null)}
        onVisibleDay={setUpcomingDay}
        view={upcomingView}
        arrangeCtx={arrangeCtx}
        eventsOn={(ymd) => eventsOn(cal.events, ymd)}
        eventDays={eventDays(cal.events).filter((day) => day <= (d.days[d.days.length - 1]?.date ?? today))}
        onViewMenu={() => setViewSheet("upcoming")}
        {...rowOps}
              />
    );
  }
  if (screen.kind === "browse") {
    return (
      <MobileBrowse
        {...header}
        banner={banner}
                projects={summaries}
        counts={counts}
        syncState={syncState}
        lastSyncedAt={formatSynced(syncStatus?.lastSynced)}
        syncOffText="同期オフ"
        syncErrorText={syncErrorText(syncStatus, syncClickable)}
        onSync={syncState === "off" ? () => push({ kind: "settings" }) : headerSync}
        onOpenProject={(name) => push({ kind: "project", name })}
        onOpenLabels={() => push({ kind: "labels" })}
        onSearch={() => push({ kind: "search" })}
        onSettings={() => push({ kind: "settings" })}
      />
    );
  }
  if (screen.kind === "search") {
    return (
      <MobileSearch
        rowContext={rowContext}
        {...header}
        banner={banner}
        onBack={back}
        query={search.query}
        onChangeQuery={search.setQuery}
        includeDone={search.includeDone}
        onToggleIncludeDone={search.toggleIncludeDone}
        hits={search.hits}
        busy={search.busy}
        onOpenHit={(h: SearchHit) => openCross(h.task)}
        onToggleDone={(h, done) =>
          void cross.toggleDone(h.task, done).then((ok) => {
            if (ok && done) offerDone(h.task);
            search.refresh();
          })
        }
              />
    );
  }
  if (screen.kind === "docs") {
    return (
      <MobileDocsList
        key={`${screen.project}\u0000${screen.section ?? ""}`}
        fill
        banner={banner}
        overlay={layers}
        onBack={back}
        today={today}
        onTabChange={goTab}
        onNotice={(text) => setFlash({ text, tone: "info" })}
        project={screen.project}
        section={screen.section}
        onOpen={(id) => push({ kind: "doc", project: screen.project, id })}
      />
    );
  }
  if (screen.kind === "doc") {
    return (
      <MobileDoc
        key={`${screen.project}\u0000${screen.id}`}
        fill
        banner={banner}
        overlay={layers}
        onBack={back}
        today={today}
        onTabChange={goTab}
        onNotice={(text) => setFlash({ text, tone: "info" })}
        project={screen.project}
        id={screen.id}
        sections={(view?.sections ?? []).map((x) => x.name)}
        onGone={back}
      />
    );
  }
  if (screen.kind === "labels") {
    const d = labelsData.data;
    if (labelsData.error) return frame("ラベル", labelsData.error, "danger");
    if (!d) return frame("ラベル", "読み込み中…");
    return <MobileLabels {...header} banner={banner} onBack={back} labels={d.labels} counts={d.counts} onOpenLabel={(name) => push({ kind: "label", name })} />;
  }
  if (screen.kind === "label") {
    const d = labelData.data;
    if (labelData.error) return frame(`@${screen.name}`, labelData.error, "danger");
    if (!d || !labelName) return frame(`@${screen.name}`, "読み込み中…");
    return (
      <MobileLabelDetail
        rowContext={rowContext}
        {...header}
        banner={banner}
        onBack={back}
        label={d.label.name}
        tasks={d.tasks}
        onToggleDone={(t, done) => void cross.toggleDone(t, done).then((ok) => ok && done && offerDone(t))}
        onOpenTask={openCross}
              />
    );
  }
  // 受信トレイ (タブ) / プロジェクト (閲覧から)
  const title = current === app.inbox ? "受信トレイ" : current;
  if (p.error) return frame(title, p.error, "danger", () => void p.reload().catch(() => undefined));
  if (!view) return frame(title, "読み込み中…");
  return (
    <MobileProjectView
      rowContext={rowContext}
      key={current}
      live
      {...header}
      banner={banner}
      onRefresh={pullRefresh}
      tab={nav.tab}
      onBack={screen.kind === "project" ? back : undefined}
      onProjectMenu={() => setProjectSheet("menu")}
      view={projectView}
      arrangeCtx={arrangeCtx}
      onViewMenu={() => setViewSheet("project")}
      onSectionMenu={(name) => setSectionSheet({ name, mode: "menu" })}
      title={title}
      project={current}
      tasks={view.tasks}
      sections={view.sections}
      onToggleDone={(t, done) => void p.completeTask(t.no, done).then((ok) => ok && done && offerDone(t))}
      onOpenTask={(t) => setDetail({ project: current, no: t.no })}
      onAddTask={(section) => openQuickAddAt({ section })}
      onAddSubtask={(t) => openQuickAddAt({ parentNo: t.no })}
      events={eventDays(cal.events, current).slice(0, 14).flatMap((day) => eventsOn(cal.events, day, current))}
      calendarNote={cal.events[current]?.needsLogin ? "このカレンダーにはログインが必要です (設定の Google カレンダー)" : cal.events[current]?.error}
      onReorder={(no, to) =>
        void p
          .moveWithin(no, to)
          .then(refreshAll)
          .catch((e) => {
            showError(e);
            void p.reload().catch(() => undefined);
          })
      }
      {...rowOps}
          />
  );
  };

  // The screen animates when it changes (push / back / tab); the sheets, the drawer and the popup sit above it, outside the animation.
  return (
    <>
      <ScreenStack screenKey={screenKey} direction={screenDirection}>
        {renderScreen()}
      </ScreenStack>
      <div style={{ position: "fixed", inset: 0, zIndex: 10, pointerEvents: "none" }}>{layers}</div>
    </>
  );
}
