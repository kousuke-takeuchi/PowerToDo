import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "../components/Button";
import { ProjectColors } from "../views/crossList";
import { Toast } from "../components/Toast";
import { completedOf, merge, toastText, undoOf } from "./completionToast";
import type { ToastState } from "./completionToast";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage, isAppError } from "../api/client";
import { confirmDiscard } from "../api/dialogs";
import { onNotificationError, onOpenQuickAdd, onOpenTask, onProjectChanged, onProjectsChanged, onWatchFailed, onWindowShown } from "../api/events";
import type { AppStateDto, Task } from "../types/model";
import { useMotionTiming } from "../motion";
import { AppShell } from "../views/AppShell";
import { ProjectView } from "../views/ProjectView";
import { QuickAddDialog } from "../views/QuickAddDialog";
import { SearchDialog } from "../views/SearchDialog";
import { SettingsDialog } from "../views/SettingsDialog";
import { UpdateDialog } from "../views/UpdateDialog";
import type { ExpandApi } from "../views/ProjectView";
import { LabelDetailView } from "../views/LabelDetailView";
import { LabelsView } from "../views/LabelsView";
import { Sidebar } from "../views/Sidebar";
import type { SidebarProps } from "../views/Sidebar";
import { TaskDialog } from "../views/TaskDialog";
import { afterRemoval, dialogTarget, neighbors, parseKey } from "./dialogNav";
import { CommentCounts, useCommentCounts, useDialogComments } from "./useComments";
import { TodayView } from "../views/TodayView";
import { UpcomingView } from "../views/UpcomingView";
import { useShellWidth, useToday } from "./hooks";
import { Banners } from "./Banners";
import { setEscFallback, useEscLayer } from "./layers";
import { useCrossViews } from "./useCrossViews";
import { heldFileName, useExternalChanges, useExternalReadFailures } from "./useExternalChanges";
import { useProject } from "./useProject";
import { useRowFocus } from "./useRowFocus";
import { PALETTE, useProjectActions } from "./useProjectActions";
import { useQuickAdd } from "./useQuickAdd";
import { useSummaries } from "./useSummaries";
import { useReminders } from "./useReminders";
import { useRowShortcuts } from "./useRowShortcuts";
import { useSearchDialog } from "./useSearchDialog";
import { useSaveErrors } from "./useSaveStatus";
import { formatSynced, syncErrorText, syncPausedText, targetName } from "./syncText";
import { useSync } from "./useSync";
import type { SyncConflicts } from "./useSyncConflicts";
import { useSettingsPanes } from "./useSettingsPanes";
import { useUpdates } from "./useUpdates";
import type { UpdateOffer } from "./useUpdates";

type Nav = SidebarProps["active"];
type Flash = { text: string; tone: "error" | "info" };

/** 新しいラベルの色 (既定、仕様 §3.3)。ラベルの「色」メニューの先頭にも出し、既定に戻せるようにする。 */
const DEFAULT_LABEL_COLOR = "var(--color-text-muted)";
const LABEL_PALETTE = [DEFAULT_LABEL_COLOR, ...PALETTE];

/** 通常画面: AppShell + Sidebar + プロジェクト画面 + クイック追加 + タスク詳細 + 保存失敗の帯。 */
export function Main({ app, syncConflicts }: { app: AppStateDto; syncConflicts: SyncConflicts }) {
  const today = useToday();
  const width = useShellWidth();
  const { errors: saveErrors, clear: clearSaveErrors } = useSaveErrors();

  const [nav, setNav] = useState<Nav>({ kind: "inbox" });
  // The task open in the task dialog (spec ① §2): over whatever view is shown.
  const [dialog, setDialog] = useState<{ project: string; no: number } | null>(null);
  // 通知 / 帯から開いたタスク: プロジェクトが読み込まれたら、そのタスクがあるか一度だけ確かめる
  const [drawer, setDrawer] = useState(false);
  // Wide layout: the sidebar was closed with its button (it slides away; the top bar's button brings it back).
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 同期 (Phase 4): サイドバーの状態、競合 / 食い違い / エラーの帯、設定の「同期」ペイン
  const sync = useSync({ active: settingsOpen, onNotice: (text, tone) => setFlash({ text, tone }) });
  const syncStatus = sync.status;
  const syncState = syncStatus?.state ?? "off";
  // 片方が空に見えて止まっているあいだ (帯で戻す方向を選ぶ) と、認証が断られたあいだ (ログインし直すか「確かめる」まで
  // 同期しない) は、「今すぐ同期」しても動かない
  const syncClickable = syncState === "error" && !syncStatus?.suspect && !syncStatus?.authRejected;
  const syncError = syncErrorText(syncStatus, syncClickable);
  const syncPaused = syncPausedText(syncStatus);
  // 同期のエラーの帯は閉じられる。エラーが続く間は同じ文言を出し直さず、直って別のエラーが起きたらまた出す。
  const [dismissedSyncError, setDismissedSyncError] = useState<string | null>(null);
  useEffect(() => {
    if (syncState !== "error") setDismissedSyncError(null);
  }, [syncState]);
  const syncErrorMessage =
    syncState === "error" && !syncStatus?.suspect && syncStatus?.message && syncStatus.message !== dismissedSyncError ? syncStatus.message : null;
  // キーボードのフォーカス行: 画面に出ている行のキー (表示順) は各ビューが知らせる。ナビゲーションで外れる。
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const reportKeys = useCallback(
    (keys: string[]) => setVisibleKeys((prev) => (prev.length === keys.length && prev.every((k, i) => k === keys[i]) ? prev : keys)),
    [],
  );
  const focus = useRowFocus(visibleKeys);
  const clearFocus = focus.clear;
  const expandApi = useRef<ExpandApi | null>(null);
  const { searchOpen, setSearchOpen, search, searchSel, setSearchSel } = useSearchDialog();

  // プロジェクト一覧・「今日」の件数・表示名 (モバイルと共有: useSummaries)
  const { summaries, displayName, setDisplayName, refreshSummaries, loadDisplayName, counts } = useSummaries(app, today);

  // 受信トレイ / プロジェクトの画面だけがタスク詳細・要修正の帯を持つ。今日 / 近日 / ラベル詳細 / フィルターとラベルは
  // 横断ビュー (useProject は受信トレイを読み続ける)。
  const projectScreen = nav.kind === "inbox" || nav.kind === "project";
  const current = nav.kind === "project" && nav.name ? nav.name : app.inbox;
  // 操作の通知 (例: 読めない繰り返しがあったので通常の完了にした) は、エラーと同じフラッシュで出す。
  const showWarnings = useCallback((w: string[]) => setFlash({ text: w.join(" / "), tone: "error" }), []);
  const p = useProject(current, { onMutated: refreshSummaries, onWarnings: showWarnings });
  const view = p.view;
  const { reduced, t } = useMotionTiming();

  const showError = useCallback((e: unknown) => setFlash({ text: errorMessage(e), tone: "error" }), []);
  const ext = useExternalChanges(showError);
  const readFailures = useExternalReadFailures();

  // Excel など外での変更の取り込み / ファイル構成の変化 / 監視の失敗 (バックエンドのイベント)。
  useEffect(
    () =>
      onProjectChanged((name, reason) => {
        if (reason === "external") setFlash({ text: `「${name}」の Excel での変更を取り込みました`, tone: "info" });
      }),
    [],
  );
  useEffect(
    () =>
      onProjectsChanged(() => {
        void refreshSummaries();
        loadDisplayName();
      }),
    [refreshSummaries, loadDisplayName],
  );
  // 監視の失敗は app_state / set_data_dir の中で起きる (この画面がイベントを聞く前) ので、起動時は DTO の watchError で出す。
  // あとからの失敗 (データフォルダの変更) はイベントで受ける。
  const watchFailed = useCallback(
    (m: string) => setFlash({ text: `ファイルの変更監視を開始できません (${m})。Excel で直した内容は再読み込みで取り込めます`, tone: "error" }),
    [],
  );
  useEffect(() => {
    if (app.watchError) watchFailed(app.watchError);
  }, [app.watchError, watchFailed]);
  useEffect(() => onWatchFailed(watchFailed), [watchFailed]);
  const navigate = useCallback(
    (target: Nav) => {
      setNav(target);
      setDialog(null);
      setDrawer(false);
      clearFocus();
    },
    [clearFocus],
  );
  const failed = summaries.filter((s) => s.loadError).map((s) => s.name);

  const { todayData, upcomingData, lastUpcoming, setUpFrom, setUpDays, labelData, labelsData, cross, refreshAll, labelName } = useCrossViews({
    nav,
    today,
    inbox: app.inbox,
    showError,
    showWarnings,
    refreshSummaries,
  });
  /** Opens the task dialog over the current view (spec ① §2.5). A project that is gone opens nothing. */
  const openTaskAt = (project: string, no: number) => {
    // 消えたプロジェクト (通知を受けてから削除 / 改名した) は何も開かない
    if (project !== app.inbox && !summaries.some((s) => s.name === project)) {
      setFlash({ text: "タスクが見つかりません", tone: "error" });
      return;
    }
    setDialog({ project, no });
    focus.set(`${project}/${no}`);
  };
  const openCross = (t: Task) => openTaskAt(t.project, t.no);
  const { qa, openQuickAdd, closeQuickAdd, setText, submit: submitQuickAdd, tokens, qaProject } = useQuickAdd({ p, current, setFlash });
  // アプリの更新: 起動 5 秒後の確認、更新ダイアログ、設定の「アップデート」ペイン
  // クイック追加 / 検索が開いているあいだ、自動で見つかった更新は出さずに待つ (入力を奪わない)
  const updates = useUpdates({ hold: qa.open || searchOpen });
  // 閉じるアニメーションのあいだも文言を保つため、最後に見つかった版を覚えておく
  const shownOffer = useRef<UpdateOffer | null>(null);
  if (updates.offer) shownOffer.current = updates.offer;

  // リマインダーの帯と、通知 / トレイ由来のイベント (open-task / open-quick-add / window-shown)。
  const reminders = useReminders({
    onError: showError,
    onInfo: (text) => setFlash({ text, tone: "info" }),
    // 開いているプロジェクトのタスクはその画面の処理で (すぐ画面に反映し、行のチェックと同時押しを防ぐ)
    complete: (project, no) => (projectScreen && project === current ? p.completeTask(no, true) : cross.setDone(project, no, true)),
    openTask: (project, no) => openTaskAt(project, no),
  });
  // イベントの購読は 1 回だけにして、呼ぶ先は毎描画の最新を参照する
  const wired = useRef({ updateOpen: !!updates.offer, openTaskAt, openQuickAdd, refreshAll, fetchPending: reminders.fetchPending, removeTask: reminders.removeTask });
  wired.current = { updateOpen: !!updates.offer, openTaskAt, openQuickAdd, refreshAll, fetchPending: reminders.fetchPending, removeTask: reminders.removeTask };
  useEffect(() => {
    const offs = [
      onOpenTask((project, no) => {
        wired.current.removeTask(project, no); // 通知から開いたタスクの帯は要らない
        wired.current.openTaskAt(project, no);
      }),
      // 更新ダイアログが開いているあいだは開かない (トレイから押されても、後ろの画面は操作できない)
      onOpenQuickAdd(() => !wired.current.updateOpen && wired.current.openQuickAdd()),
      // 通知のボタン (完了) が失敗した (保留中のプロジェクトなど)。Rust 側がウィンドウを出してから送る
      onNotificationError((text) => setFlash({ text, tone: "error" })),
      // 隠れている間に変わった分 (Excel での編集、発火したリマインダー) を取り直す
      onWindowShown(() => {
        wired.current.refreshAll();
        void wired.current.fetchPending();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // 情報メッセージは数秒で消す (エラーは閉じるまで残す)。
  useEffect(() => {
    if (flash?.tone !== "info") return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  // Completion toast (spec ④ §5): completions in a row share one toast; 「元に戻す」 undoes each of them.
  const [toast, setToast] = useState<ToastState | null>(null);
  const completed = useCallback((t: Task) => setToast((s) => merge(s, completedOf(t))), []);
  /** Completes / reopens `t` through the project screen or the cross actions, then adds a completion to the toast. */
  const crossToggle = (t: Task, done: boolean) =>
    cross.toggleDone(t, done).then((ok) => {
      if (ok && done) completed(t);
      return ok;
    });
  const undoToast = async (state: ToastState) => {
    setToast(null);
    for (const e of state.entries) {
      const u = undoOf(e);
      const onScreen = projectScreen && e.project === current;
      await (onScreen ? p.completeTask(u.no, false) : cross.setDone(u.project, u.no, false));
      if (u.kind === "restore") {
        await (onScreen ? p.updateTask(u.no, u.patch) : api.updateTask(u.project, u.no, u.patch).catch(showError));
      }
    }
    refreshAll();
  };

  const { openAny } = useRowShortcuts({
    focus,
    visibleKeys,
    focusedTaskPool: () =>
      nav.kind === "today"
        ? [...(todayData.data?.overdue ?? []), ...(todayData.data?.today ?? [])]
        : nav.kind === "upcoming"
          ? (lastUpcoming.current?.days.flatMap((d) => d.tasks) ?? [])
          : nav.kind === "label"
            ? (labelData.data?.tasks ?? [])
            : projectScreen && view && view.project.name === current
              ? view.tasks
              : [],
    p,
    cross,
    current,
    projectScreen,
    today,
    openCross,
    dialog,
    setDialog,
    expandApi,
    // Row keys act on the focused row, which the modal task dialog hides: off while it is open.
    enabled: !qa.open && !searchOpen && !settingsOpen && !updates.offer && !dialog,
    navigate,
    openQuickAdd,
    openSearch: () => setSearchOpen(true),
    onCompleted: completed,
  });
  // Esc: 開いているレイヤーが無ければ行フォーカスを外す (layers.ts)
  useEffect(() => {
    setEscFallback(clearFocus);
    return () => setEscFallback(null);
  }, [clearFocus]);

  // 狭い幅のドロワー: Esc で閉じる (Esc レイヤー。上に開いたものがあればそちらが先に閉じる)。幅が戻ったら閉じる。
  useEffect(() => {
    if (drawer && width !== 960) setDrawer(false);
  }, [drawer, width]);
  useEscLayer(drawer && width === 960, () => setDrawer(false));

  const { createProject, renameProject, deleteProject, deleteLabel } = useProjectActions({
    current,
    summaries,
    refreshSummaries,
    navigate,
    showError,
    ext,
    labelsData,
  });

  // データフォルダが変わった: 開いていたプロジェクトは新しいフォルダに無いかもしれないので、受信トレイに戻して読み直す。
  // 古いフォルダの保存失敗 / 通知の帯はもう当てはまらないので消す。
  const dataDirChanged = () => {
    clearSaveErrors();
    readFailures.clear();
    reminders.clear(); // 古いフォルダのタスクへの帯 (受信トレイは新しいフォルダにもある) で別のタスクを触らない
    setFlash(null);
    // set_data_dir の中で出た watch-failed のフラッシュは上で消えるので、状態を聞き直して出す
    void api
      .watchStatus()
      .then((m) => m && watchFailed(m))
      .catch(() => undefined);
    p.clearNotice();
    navigate({ kind: "inbox" });
    if (current === app.inbox) void p.reload().catch(() => undefined); // 名前が変わらないと useProject は読み直さない
    void refreshSummaries();
    loadDisplayName();
  };

  const reveal = () => void api.revealDataDir().catch(showError);

  const settingsPanes = useSettingsPanes(settingsOpen, {
    onDataDirChanged: dataDirChanged,
    onDisplayNameChanged: (name) => setDisplayName(name || undefined),
  });

  // 読み込みに失敗したプロジェクトは未保存の変更を持たないので、確認なしで再試行する。
  const retryLoad = () =>
    void p
      .reload()
      .catch(() => undefined)
      .finally(() => void ext.refresh());

  // 「再読み込み」(FixBanner): 未保存の変更があると reload_project は `unsaved` で断る。確認できたら破棄して読み直す。
  // window.confirm は dialog プラグインが非同期版に置き換えるので使わない (src/api/dialogs.ts)。
  // reload_project は保留も解くので、終わったら保留の一覧を取り直す。
  const reloadProject = async () => {
    try {
      await p.reload();
    } catch (e) {
      if (!isAppError(e) || e.kind !== "unsaved") return;
      const ok = await confirmDiscard("未保存の変更を破棄して読み直しますか？", "再読み込み").catch(() => false);
      if (ok) await p.reload(true).catch(() => undefined);
    } finally {
      void ext.refresh();
    }
  };

  const sidebar = (
    <Sidebar
      onClose={() => (width === 960 ? setDrawer(false) : setSidebarClosed(true))}
      active={nav}
      counts={counts}
      projects={summaries}
      syncState={syncState}
      lastSyncedAt={formatSynced(syncStatus?.lastSynced)}
      syncDetail={syncStatus?.message}
      syncOffText="同期オフ"
      syncErrorText={syncError}
      syncPausedText={syncPaused}
      onSyncClick={syncClickable ? () => void sync.syncNow(true) : undefined}
      displayName={displayName}
      onNavigate={navigate}
      onAddTask={() => {
        setDrawer(false);
        openQuickAdd();
      }}
      onSearch={() => {
        setDrawer(false);
        setSearchOpen(true);
      }}
      onCreateProject={(name) => void createProject(name)}
      onOpenSettings={() => {
        setDrawer(false);
        setSettingsOpen(true);
      }}
    />
  );

  const qaColor = summaries.find((s) => s.name === qaProject)?.color;
  // Comment counts of the projects whose rows are on screen (spec ① §3.3).
  const shownProjects = useMemo(() => visibleKeys.map((k) => parseKey(k).project), [visibleKeys]);
  const commentCounts = useCommentCounts(shownProjects);
  const projectColors = useMemo(() => Object.fromEntries(summaries.map((s) => [s.name, s.color])), [summaries]);

  // ---- タスクの詳細ダイアログ (spec ① §2) ----
  // The task comes from the open project's useProject on its own screen, else from a second one (enabled on demand).
  const target = dialogTarget(dialog, current, projectScreen);
  const other = useProject(target === "other" && dialog ? dialog.project : current, {
    enabled: target === "other",
    onMutated: refreshSummaries,
    onWarnings: showWarnings,
  });
  const src = target === "current" ? p : other;
  const dlgView = target === "none" ? null : src.view;
  const dlgTask = dialog && dlgView && dlgView.project.name === dialog.project ? dlgView.tasks.find((t) => t.no === dialog.no) : undefined;
  const dlgKey = dialog ? `${dialog.project}/${dialog.no}` : null;
  const dlgComments = useDialogComments(dialog, showError);
  const { prev, next } = dlgKey ? neighbors(visibleKeys, dlgKey) : {};
  /** Shows the task with row key `k` in the dialog (and focuses its row), or closes the dialog. */
  const goDialog = (k?: string | null) => {
    if (!k) {
      setDialog(null);
      return;
    }
    setDialog(parseKey(k));
    focus.set(k);
  };
  /** Rows that leave with the dialog's task (its subtasks, deleted or moved with it). */
  const leavingWith = (no: number): Set<string> => {
    const out = new Set<string>();
    if (!dlgView || !dialog) return out;
    const walk = (parent: number) => {
      for (const t of dlgView.tasks) {
        if (t.parentNo === parent) {
          out.add(`${dialog.project}/${t.no}`);
          walk(t.no);
        }
      }
    };
    walk(no);
    return out;
  };
  /** After a change through the second source, the open views (Today, the project screen) catch up. */
  const afterOther = () => {
    if (target === "other") {
      refreshAll();
      if (projectScreen) void p.refresh();
    }
  };
  // The task vanished (deleted elsewhere, gone after a sync) or its project failed to load: close, never show another task.
  useEffect(() => {
    if (!dialog || target === "none") return;
    if (src.error) {
      setDialog(null);
      return;
    }
    if (dlgView && dlgView.project.name === dialog.project && !dlgView.tasks.some((t) => t.no === dialog.no)) setDialog(null);
  }, [dialog, target, dlgView, src.error]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const dialogOpen = dialog !== null;
  useEffect(() => {
    if (!dialogOpen) return;
    void api
      .labels()
      .then((d) => setAllLabels(d.labels.map((l) => l.name)))
      .catch(() => undefined);
  }, [dialogOpen]);
  // While j / k moves to a task of another project, its source loads; keep the last dialog on screen meanwhile
  // (spec ① §2.5: no motion between tasks), instead of unmounting it for a frame.
  const lastDialogEl = useRef<React.ReactNode>(null);
  const freshDialogEl =
    dialog && dlgView && dlgTask && dlgKey ? (
      <motion.div
        key="task-dialog"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: t(0.1) }}
        exit={{ opacity: 0, transition: t(0.08) }}
        style={{ position: "absolute", inset: 0 }}
      >
        <TaskDialog
          key={dlgKey}
          task={dlgTask}
          subtasks={dlgView.tasks.filter((x) => x.parentNo === dlgTask.no).sort((a, b) => a.order - b.order)}
          project={dlgView.project}
          section={dlgTask.category ?? undefined}
          today={today}
          layout={width === 960 ? "narrow" : "wide"}
          onClose={() => setDialog(null)}
          onOpenProject={() => navigate(dialog.project === app.inbox ? { kind: "inbox" } : { kind: "project", name: dialog.project })}
          onPrev={prev ? () => goDialog(prev) : undefined}
          onNext={next ? () => goDialog(next) : undefined}
          onChange={(patch) =>
            src.updateTask(dlgTask.no, patch).then((ok) => {
              if (ok) afterOther();
              return ok;
            })
          }
          onToggleDone={(done) => {
            const t = dlgTask;
            // Spec ① §2.5: completing moves on to the next task (taken from the list as it was before).
            const after = done ? afterRemoval(visibleKeys, dlgKey) : undefined;
            void src.completeTask(t.no, done).then((ok) => {
              if (!ok) return;
              afterOther();
              if (done) {
                completed(t);
                goDialog(after);
              }
            });
          }}
          onDelete={() => {
            const after = afterRemoval(visibleKeys, dlgKey, leavingWith(dlgTask.no));
            void src.deleteTask(dlgTask.no).then((ok) => {
              if (!ok) return;
              afterOther();
              goDialog(after);
            });
          }}
          onParseRecurrence={api.parseRecurrence}
          onAddSubtask={(title) => void src.addSubtask(dlgTask.no, title).then(afterOther)}
          onToggleSubtask={(no, done) => void src.completeTask(no, done).then(afterOther)}
          projects={summaries.map((s) => ({ name: s.name, sections: s.name === dlgView.project.name ? dlgView.sections.map((x) => x.name) : [] }))}
          onMove={(toProject, toSection) => {
            // Spec ① §2.5: moving to another project goes on to the next task; a new section keeps the task (same No).
            const leaves = toProject !== dialog.project;
            const after = leaves ? afterRemoval(visibleKeys, dlgKey, leavingWith(dlgTask.no)) : null;
            void api
              .moveTask(dialog.project, dialog.no, toProject, toSection)
              .then(() => {
                refreshAll();
                void p.refresh();
                if (target === "other") void other.refresh();
                if (leaves) goDialog(after);
              })
              .catch(showError);
          }}
          allLabels={allLabels}
          comments={dlgComments.comments}
          commentsFailed={dlgComments.failed}
          me={displayName}
          onAddComment={dlgComments.add}
          onEditComment={dlgComments.edit}
          onDeleteComment={dlgComments.remove}
        />
      </motion.div>
    ) : null;
  const dialogLoading = dialog !== null && !dlgTask && target !== "none" && src.loading && !src.error;
  const dialogEl = freshDialogEl ?? (dialogLoading ? lastDialogEl.current : null);
  lastDialogEl.current = dialog ? dialogEl : null;

  // ---- 本文 ----
  let body: React.ReactNode;
  const loading = <div style={{ padding: "var(--space-6) 0", color: "var(--color-text-secondary)", fontSize: 14 }}>読み込み中…</div>;
  const failure = (message: string) => (
    <div role="alert" style={{ padding: "var(--space-6) 0", color: "var(--color-danger)", fontSize: 14 }}>
      {message}
    </div>
  );
  if (nav.kind === "labels") {
    const d = labelsData.data;
    body = labelsData.error ? (
      failure(labelsData.error)
    ) : !d ? (
      loading
    ) : (
      <LabelsView
        labels={d.labels}
        filters={[]}
        counts={d.counts}
        palette={LABEL_PALETTE}
        onOpenLabel={(name) => navigate({ kind: "label", name })}
        onAddLabel={(name) =>
          void api
            .addLabel(name, DEFAULT_LABEL_COLOR)
            .then(labelsData.refresh)
            .catch(showError)
        }
        onRenameLabel={(name, newName) => void api.renameLabel(name, newName).then(labelsData.refresh).catch(showError)}
        onChangeColor={(name, color) => void api.updateLabel(name, color).then(labelsData.refresh).catch(showError)}
        onDeleteLabel={(name) => void deleteLabel(name)}
        onAddFilter={() => setFlash({ text: "フィルターは Phase 5 で実装します", tone: "info" })}
      />
    );
  } else if (nav.kind === "today") {
    const d = todayData.data;
    body = todayData.error ? (
      failure(todayData.error)
    ) : !d ? (
      loading
    ) : (
      <TodayView
        tasks={[...d.overdue, ...d.today]}
        today={today}
        hideOverdue={d.overdue.length === 0}
        onToggleDone={crossToggle}
        onOpenTask={openCross}
        focusedKey={focus.focusedKey ?? undefined}
        onVisibleKeys={reportKeys}
        onAddTask={(title) => void cross.addToInbox({ title, due: today })}
        onReschedule={(due) => void api.rescheduleOverdue(today, due).catch(showError).finally(refreshAll)}
        hiddenProjects={failed}
      />
    );
  } else if (nav.kind === "upcoming") {
    const d = lastUpcoming.current;
    body = upcomingData.error ? (
      failure(upcomingData.error)
    ) : !d ? (
      loading
    ) : (
      <UpcomingView
        tasks={[]}
        today={today}
        days={d.days}
        onExtend={() => setUpDays((n) => Math.min(91, n + 7))}
        onJumpTo={(from) => {
          setUpFrom(from);
          setUpDays(7);
        }}
        onToggleDone={crossToggle}
        onOpenTask={openCross}
        focusedKey={focus.focusedKey ?? undefined}
        onVisibleKeys={reportKeys}
        onAddTask={(date, title) => void cross.addToInbox({ title, due: date })}
        hiddenProjects={failed}
      />
    );
  } else if (nav.kind === "label") {
    const d = labelData.data;
    body = labelData.error ? (
      failure(labelData.error)
    ) : !d || !labelName ? (
      loading
    ) : (
      <LabelDetailView
        label={d.label.name}
        tasks={d.tasks}
        today={today}
        onToggleDone={crossToggle}
        onOpenTask={openCross}
        focusedKey={focus.focusedKey ?? undefined}
        onVisibleKeys={reportKeys}
        onAddTask={(title) => void cross.addToInbox({ title, labels: [labelName] })}
        hiddenProjects={failed}
      />
    );
  } else if (p.error) {
    body = (
      <ProjectView
        project={current}
        tasks={[]}
        sections={[]}
        state="error"
        errorDetail={p.error}
        onRetryLoad={retryLoad}
        onRevealFile={reveal}
      />
    );
  } else if (!view) {
    body = loading;
  } else {
    body = (
      <ProjectView
        key={current}
        project={current}
        tasks={view.tasks}
        sections={view.sections}
        today={today}
        invalidRows={view.invalidRows}
        focusedKey={focus.focusedKey ?? undefined}
        onVisibleKeys={reportKeys}
        onExpandApi={(api) => (expandApi.current = api)}
        onOpenTask={(t) => openAny(t)}
        onToggleDone={(t, done) => void p.completeTask(t.no, done).then((ok) => ok && done && completed(t))}
        onAddTask={(section, title) => void p.addTask({ title, section })}
        onAddSubtask={(parent, title) => void p.addSubtask(parent.no, title)}
        onDeleteTask={(t) => {
          if (dialog?.project === t.project && dialog.no === t.no) setDialog(null);
          void p.deleteTask(t.no);
        }}
        onAddSection={(name) => void p.addSection(name)}
        onRenameSection={(from, to) => void p.renameSection(from, to)}
        onRenameProject={current === app.inbox ? undefined : (name) => void renameProject(name)}
        onDeleteProject={current === app.inbox ? undefined : () => void deleteProject()}
      />
    );
  }

  const invalidCount = projectScreen && !p.error && view ? view.invalidRows.length : 0;
  const banner = (
    <Banners
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
      // retry_save の失敗は save-status イベントで保存失敗の帯に出るので、catch は握りつぶすだけ (二重表示しない)
      onRetrySave={(project) => void api.retrySave(project).catch(() => undefined)}
      readFailures={readFailures}
      held={ext.held}
      heldFileName={heldFileName}
      onResolve={(project, choice) => void ext.resolve(project, choice)}
      invalidCount={invalidCount}
      onReveal={reveal}
      onReload={() => void reloadProject()}
      // While the dialog shows a task of another project, that project's command errors are the ones to show.
      notice={target === "other" ? (other.notice ?? p.notice) : p.notice}
      onClearNotice={() => {
        p.clearNotice();
        other.clearNotice();
      }}
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

  const overlay = (
    <>
      {/* 狭い幅のドロワー: scrim は 150ms でフェード、サイドバーは左から 250ms でスライド */}
      <AnimatePresence initial={false}>
        {width === 960 && drawer && (
          <motion.div
            key="drawer"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t(0.15)}
            onClick={(e) => {
              if (e.target === e.currentTarget) setDrawer(false);
            }}
            style={{ width: "100%", height: "100%", display: "flex", background: "var(--color-scrim)", pointerEvents: "auto" }}
          >
            <motion.div
              initial={{ x: reduced ? 0 : "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: reduced ? 0 : "-100%" }}
              transition={t(0.2)}
              style={{ flex: "0 0 280px", width: 280, height: "100%" }}
            >
              {sidebar}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <Toast key="toast" text={toastText(toast)} onUndo={() => void undoToast(toast)} onClose={() => setToast(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>{dialogEl}</AnimatePresence>
      <QuickAddDialog
        open={qa.open}
        tokens={tokens}
        project={qaProject}
        projectColor={qaColor}
        text={qa.text}
        onChangeText={setText}
        onSubmit={(text) => void submitQuickAdd(text)}
        busy={qa.busy}
        error={qa.error}
        onClose={closeQuickAdd}
      />
      <SearchDialog
        open={searchOpen}
        query={search.query}
        onChangeQuery={(q) => {
          search.setQuery(q);
          setSearchSel(0);
        }}
        includeDone={search.includeDone}
        onToggleIncludeDone={() => {
          search.toggleIncludeDone();
          setSearchSel(0);
        }}
        hits={search.hits}
        selected={searchSel}
        onSelect={setSearchSel}
        onOpen={(h) => {
          setSearchOpen(false);
          openCross(h.task);
        }}
        onToggleDone={(h, done) => void crossToggle(h.task, done).then(() => search.refresh())}
        onClose={() => setSearchOpen(false)}
        today={today}
        busy={search.busy}
      />
      {/* 閉じるアニメーションのため常にマウントし open で出し入れする (閉じたときの初期化は SettingsDialog 側) */}
      <SettingsDialog
        open={settingsOpen}
        syncPane={sync.pane}
        initialPane="account"
        onClose={() => setSettingsOpen(false)}
        dataPane={settingsPanes.data}
        accountPane={settingsPanes.account}
        notificationsPane={{ ...settingsPanes.notifications, trayError: app.trayError }}
        datetimePane={settingsPanes.datetime}
        updatesPane={{
          status: updates.status,
          checking: updates.checking,
          upToDate: updates.upToDate,
          error: updates.error,
          onToggleAutoCheck: (v) => void updates.setAutoCheck(v),
          onCheck: () => void updates.check(true),
          onOpenReleasePage: () => void updates.openReleasePage(),
        }}
      />
      {/* 設定の上に重ねる (後に置くので Esc も先にこちらへ届く) */}
      {shownOffer.current && updates.status && (
        <UpdateDialog
          open={!!updates.offer}
          currentVersion={updates.status.currentVersion}
          version={shownOffer.current.version}
          notes={shownOffer.current.notes}
          installing={updates.installing}
          progress={updates.progress}
          error={updates.installError}
          onInstall={() => void updates.install()}
          onClose={updates.later}
        />
      )}
    </>
  );

  return (
    <ProjectColors.Provider value={projectColors}>
    <CommentCounts.Provider value={commentCounts}>
    <AppShell
      width={width}
      fill
      syncState={syncState}
      sidebar={sidebar}
      rail={{
        lastSyncedAt: formatSynced(syncStatus?.lastSynced),
        syncDetail: syncStatus?.message,
        syncOffText: "同期オフ",
        syncErrorText: syncError,
        syncPausedText: syncPaused,
        onSyncClick: syncClickable ? () => void sync.syncNow(true) : undefined,
        onExpand: () => setDrawer(true),
        onAddTask: openQuickAdd,
        onNavigate: (t) => {
          if (t === "search") setSearchOpen(true);
          else navigate({ kind: t });
        },
      }}
      banner={banner}
      overlay={overlay}
      sidebarHidden={sidebarClosed}
      topBarLeft={
        width === 960 || sidebarClosed ? (
          <Button
            variant="icon"
            icon={PanelLeftOpen}
            ariaLabel="サイドバーを開く"
            onClick={() => (width === 960 ? setDrawer(true) : setSidebarClosed(false))}
          />
        ) : undefined
      }
    >
      {body}
    </AppShell>
    </CommentCounts.Provider>
    </ProjectColors.Provider>
  );
}
