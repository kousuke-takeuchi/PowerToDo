import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { api, errorMessage } from "../api/client";
import { onNotificationError, onOpenTask, onProjectChanged, onProjectsChanged, onWatchFailed, onWindowShown } from "../api/events";
import type { AppStateDto, Label, NotificationPermission, SearchHit, Task } from "../types/model";
import { BottomSheet } from "../views/mobile/BottomSheet";
import { DateSheet } from "../views/mobile/DateSheet";
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
import { ProjectMenuSheet } from "../views/mobile/ProjectMenuSheet";
import { TEXT_SHEET_FORM, TextSheet } from "../views/mobile/TextSheet";
import { INITIAL_NAV, crossNavOf, projectOf, reduceNav, screenOf, type BrowseScreen, type MobileTab } from "./mobileNav";
import { useSystemTheme } from "./useSystemTheme";
import { ReminderSheet } from "../views/mobile/ReminderSheet";
import { PrioritySheet } from "../views/mobile/PrioritySheet";
import { TaskMenuSheet } from "../views/mobile/TaskMenuSheet";
import { Banners } from "./Banners";
import { useToday } from "./hooks";
import { heldFileName, useExternalChanges, useExternalReadFailures } from "./useExternalChanges";
import { useCrossViews } from "./useCrossViews";
import { useProject } from "./useProject";
import { insertToken } from "./quickAddInsert";
import { useQuickAdd } from "./useQuickAdd";
import { useReminders } from "./useReminders";
import { useSaveErrors } from "./useSaveStatus";
import { useSettingsPanes } from "./useSettingsPanes";
import { useSearch } from "./useSearch";
import { useCommentCounts } from "./useComments";
import { useSummaries } from "./useSummaries";
import type { RowContext } from "../views/mobile/rowProps";
import { useSync } from "./useSync";
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
/** 開いている下部シート。状態はここ (画面の子ではなく MobileMain) に持つ: 一覧の再読み込みや画面の差し替えで失わない。 */
type SheetState = { kind: "menu" | "date" | "priority" | "move"; task: Task } | { kind: "reschedule" } | null;

/**
 * iPhone の通常画面 (仕様 §4): 下部タブ (今日 / 近日 / 検索 / 一覧) + ドロワー + プロジェクト / ラベルの画面 + タスク詳細。
 * デスクトップの Main と同じフックにつなぐ。「一覧」のタブはドロワーを開き、選んだ受信トレイ / プロジェクト / ラベルを本文に出す。
 */
export function MobileMain({ app, syncConflicts }: { app: AppStateDto; syncConflicts: SyncConflicts }) {
  useSystemTheme();
  const today = useToday();
  const { errors: saveErrors } = useSaveErrors();

  // 画面: 下のタブと「閲覧」の中の画面の積み重ね (spec ④ iPhone §3.1-3.2)。起動直後は受信トレイ。
  const [nav, dispatchNav] = useReducer(reduceNav, INITIAL_NAV);
  const screen = screenOf(nav);
  const settingsOpen = screen.kind === "settings";
  const goTab = (id: MobileTab) => dispatchNav({ type: "tab", tab: id });
  const push = (s: BrowseScreen) => dispatchNav({ type: "push", screen: s });
  const back = () => dispatchNav({ type: "back" });
  // プロジェクトの「…」(名前を変更 / 削除)
  const [projectSheet, setProjectSheet] = useState<"menu" | "rename" | null>(null);
  // 開いているタスク詳細 (全画面)。閉じると元の画面に戻る。
  const [detail, setDetail] = useState<{ project: string; no: number } | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  // クイック追加の上に重ねるリマインダーのシート
  const [qaReminderSheet, setQaReminderSheet] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("granted");

  const { summaries, refreshSummaries, loadDisplayName, counts } = useSummaries(app, today);

  const commentCounts = useCommentCounts(summaries.map((s) => s.name));
  const rowContext = useMemo<Omit<RowContext, "today">>(
    () => ({ inbox: app.inbox, colors: Object.fromEntries(summaries.map((s) => [s.name, s.color])), comments: commentCounts }),
    [app.inbox, summaries, commentCounts],
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
  const settingsPanes = useSettingsPanes(settingsOpen, { onDataDirChanged: () => undefined, onDisplayNameChanged: () => loadDisplayName() });
  // 引っ張って更新: 同期してから、見えている一覧を読み直す。同期先が無いときは同期は何もせず、読み直しだけ。
  const pullRefresh = async () => {
    await sync.syncNow(true);
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

  const { qa, openQuickAdd, closeQuickAdd, setText, setReminders, submit, tokens, qaProject } = useQuickAdd({ p, current: navCurrent, setFlash });

  useEffect(() => {
    if (!qa.open) setQaReminderSheet(false);
  }, [qa.open]);

  // ラベルのシートに並べる、ストアにあるラベル (詳細を開いたとき読む)
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const detailOpen = detail !== null;
  useEffect(() => {
    if (!detailOpen) return;
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
  }, [detailOpen, showError]);

  // ---- 行の操作 (スワイプ / 長押しのシート)。開いているプロジェクトの行は useProject、横断ビューの行は cross (操作のあと refreshAll) ----
  const closeSheet = () => setSheet(null);
  const inCurrent = (t: Task) => (listProject || !!detail) && t.project === current;
  const setDue = (t: Task, date?: string) => {
    if (inCurrent(t)) void p.updateTask(t.no, { due: date ?? null, dueTime: date ? undefined : null });
    else void cross.setDue(t, date ?? null);
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
      await api.moveTask(t.project, t.no, toProject, toSection);
    } catch (e) {
      showError(e);
    }
    if (listProject || detail) void p.reload().catch(() => undefined);
    refreshAll();
  };
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

  const reveal = () => setFlash({ text: "「ファイル」アプリの PowerToDo フォルダで確認できます", tone: "info" });
  const header = { fill: true as const, onFab: openQuickAdd, onTabChange: goTab, today };

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
  const layers = (
    <>
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
            onInsert={(kind) => setText(insertToken(qa.text, kind))}
            reminders={qa.reminders}
            onPickReminder={() => setQaReminderSheet(true)}
            projectName={qaProject === app.inbox ? "受信トレイ" : qaProject}
            covered={qaReminderSheet}
            onClose={closeQuickAdd}
          />
        )}
      </AnimatePresence>
      <BottomSheet fill open={qa.open && qaReminderSheet} title="リマインダー" onClose={() => setQaReminderSheet(false)}>
        <ReminderSheet value={qa.reminders} onChange={setReminders} />
      </BottomSheet>
      <BottomSheet fill confirmForm={projectSheet === "rename" ? TEXT_SHEET_FORM : undefined} open={projectSheet !== null} title={projectSheet === "rename" ? "名前を変更" : navCurrent} onClose={() => setProjectSheet(null)}>
        {projectSheet === "menu" && (
          <ProjectMenuSheet project={navCurrent} onRename={() => setProjectSheet("rename")} onDelete={() => void deleteProject()} onClose={() => setProjectSheet(null)} />
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
        size={sheet?.kind === "move" ? "large" : "auto"}
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
            onDelete={() => removeTask(sheet.task)}
            onClose={closeSheet}
          />
        )}
        {sheet?.kind === "date" && (
          <DateSheet value={sheet.task.due} time={sheet.task.dueTime} today={today} onChange={(v) => setDue(sheet.task, v.date)} onClose={closeSheet} />
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
            onChange={(v) => {
              if (v.date) void api.rescheduleOverdue(today, v.date).catch(showError).finally(refreshAll);
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
      overlay={layers}
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

  // ---- 設定 (全画面) ----
  if (settingsOpen && !detail) {
    return (
      <MobileSettings
        fill
        banner={banner}
        overlay={layers}
        onBack={back}
        onTabChange={goTab}
        today={today}
        sync={sync.pane}
        notifications={{ ...settingsPanes.notifications, permission }}
        onToggleNotifications={toggleNotifications}
        onRequestPermission={requestPermission}
        displayName={settingsPanes.account.displayName}
        onDisplayName={settingsPanes.account.onSaveDisplayName}
        displayNameBusy={settingsPanes.account.busy}
        displayNameError={settingsPanes.account.error}
        dataDirHint={DATA_DIR_HINT}
      />
    );
  }

  // ---- タスク詳細 (全画面) ----
  if (detail) {
    const openTask = view?.tasks.find((t) => t.no === detail.no);
    if (!view || !openTask) {
      return (
        <MobileShell
          fill
          banner={banner}
          title="タスク詳細"
          onBack={() => setDetail(null)}
          overlay={layers}
        >
          <div style={{ padding: "var(--space-6) 16px", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>読み込み中…</div>
        </MobileShell>
      );
    }
    return (
      <MobileTaskDetail
        key={`${detail.project}/${openTask.no}`}
        live
        fill
        today={today}
        task={openTask}
        subtasks={view.tasks.filter((t) => t.parentNo === openTask.no).sort((a, b) => a.order - b.order)}
        project={view.project}
        section={openTask.category ?? undefined}
        onBack={() => setDetail(null)}
        onToggleDone={(done) => void p.completeTask(openTask.no, done).then(refreshAll)}
        onToggleSubtask={(t, done) => void p.completeTask(t.no, done).then(refreshAll)}
        onChange={(patch) => void p.updateTask(openTask.no, patch).then(refreshAll)}
        onAddSubtask={(title) => void p.addSubtask(openTask.no, title).then(refreshAll)}
        onDelete={() => {
          setDetail(null);
          void p.deleteTask(openTask.no).then(refreshAll);
        }}
        labels={allLabels}
        onParseRecurrence={api.parseRecurrence}
        banner={banner}
        overlay={layers}
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
        onToggleDone={(t, done) => void cross.toggleDone(t, done)}
        onOpenTask={openCross}
        onReschedule={() => setSheet({ kind: "reschedule" })}
        {...rowOps}
        overlay={layers}
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
        onToggleDone={(t, done) => void cross.toggleDone(t, done)}
        onOpenTask={openCross}
        onExtend={() => setUpDays((n) => Math.min(91, n + 7))}
        {...rowOps}
        overlay={layers}
      />
    );
  }
  if (screen.kind === "browse") {
    return (
      <MobileBrowse
        {...header}
        banner={banner}
        overlay={layers}
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
        onToggleDone={(h, done) => void cross.toggleDone(h.task, done).then(() => search.refresh())}
        overlay={layers}
      />
    );
  }
  if (screen.kind === "labels") {
    const d = labelsData.data;
    if (labelsData.error) return frame("ラベル", labelsData.error, "danger");
    if (!d) return frame("ラベル", "読み込み中…");
    return <MobileLabels {...header} banner={banner} onBack={back} labels={d.labels} counts={d.counts} onOpenLabel={(name) => push({ kind: "label", name })} overlay={layers} />;
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
        onToggleDone={(t, done) => void cross.toggleDone(t, done)}
        onOpenTask={openCross}
        overlay={layers}
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
      onProjectMenu={screen.kind === "project" ? () => setProjectSheet("menu") : undefined}
      title={title}
      project={current}
      tasks={view.tasks}
      sections={view.sections}
      onToggleDone={(t, done) => void p.completeTask(t.no, done)}
      onOpenTask={(t) => setDetail({ project: current, no: t.no })}
      {...rowOps}
      overlay={layers}
    />
  );
}
