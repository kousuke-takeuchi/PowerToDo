import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage, isAppError } from "../api/client";
import { confirmDiscard } from "../api/dialogs";
import { onProjectChanged, onProjectsChanged, onWatchFailed } from "../api/events";
import type { Counts } from "../mock/data";
import type { AppStateDto, CountsDto, ProjectSummary, Task } from "../types/model";
import { useMotionTiming } from "../motion";
import { AppShell } from "../views/AppShell";
import { ProjectView } from "../views/ProjectView";
import { QuickAddDialog } from "../views/QuickAddDialog";
import { SearchDialog } from "../views/SearchDialog";
import { SettingsDialog } from "../views/SettingsDialog";
import type { ExpandApi } from "../views/ProjectView";
import { LabelDetailView } from "../views/LabelDetailView";
import { LabelsView } from "../views/LabelsView";
import { Sidebar } from "../views/Sidebar";
import type { SidebarProps } from "../views/Sidebar";
import { TaskDetailPanel } from "../views/TaskDetailPanel";
import { TodayView } from "../views/TodayView";
import { UpcomingView } from "../views/UpcomingView";
import { useShellWidth, useToday } from "./hooks";
import { Banners } from "./Banners";
import { setEscFallback, useEscLayer } from "./layers";
import { useCrossView } from "./useCrossView";
import { useCrossViews } from "./useCrossViews";
import { heldFileName, useExternalChanges, useExternalReadFailures } from "./useExternalChanges";
import { useProject } from "./useProject";
import { useRowFocus } from "./useRowFocus";
import { PALETTE, useProjectActions } from "./useProjectActions";
import { useQuickAdd } from "./useQuickAdd";
import { useRowShortcuts } from "./useRowShortcuts";
import { useSearchDialog } from "./useSearchDialog";
import { useSaveErrors } from "./useSaveStatus";
import { useSettingsPanes } from "./useSettingsPanes";

type Nav = SidebarProps["active"];
type Flash = { text: string; tone: "error" | "info" };

/** 新しいラベルの色 (既定、仕様 §3.3)。ラベルの「色」メニューの先頭にも出し、既定に戻せるようにする。 */
const DEFAULT_LABEL_COLOR = "var(--color-text-muted)";
const LABEL_PALETTE = [DEFAULT_LABEL_COLOR, ...PALETTE];

/** 通常画面: AppShell + Sidebar + プロジェクト画面 + クイック追加 + タスク詳細 + 保存失敗の帯。 */
export function Main({ app }: { app: AppStateDto }) {
  const today = useToday();
  const width = useShellWidth();
  const { errors: saveErrors, clear: clearSaveErrors } = useSaveErrors();

  const [nav, setNav] = useState<Nav>({ kind: "inbox" });
  const [summaries, setSummaries] = useState<ProjectSummary[]>(app.projects);
  const [displayName, setDisplayName] = useState<string | undefined>();
  const [openNo, setOpenNo] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // サイドバーの「今日」の件数 (期限が今日以前の未完了。project-changed / 保存完了でも更新される)。
  const countsData = useCrossView<CountsDto>(() => api.counts(today), [today]);
  const refreshCounts = countsData.refresh;

  const refreshSummaries = useCallback(async () => {
    refreshCounts();
    try {
      setSummaries(await api.listProjects());
    } catch {
      // サイドバーの件数が古いままになるだけ。次の操作でまた更新する。
    }
  }, [refreshCounts]);

  const loadDisplayName = useCallback(() => {
    api
      .settings()
      .then((s) => setDisplayName(s.displayName || undefined))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshSummaries();
    loadDisplayName();
  }, [refreshSummaries, loadDisplayName]);

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
      setOpenNo(null);
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
  /** 横断ビューのタスクを、そのプロジェクトの画面で詳細パネルつきで開く。navigate が openNo を消すので、その後に設定する。 */
  const openCross = (t: Task) => {
    navigate(t.project === app.inbox ? { kind: "inbox" } : { kind: "project", name: t.project });
    setOpenNo(t.no);
  };
  const { qa, openQuickAdd, closeQuickAdd, setText, submit: submitQuickAdd, tokens, qaProject } = useQuickAdd({ p, current, setFlash });

  // 情報メッセージは数秒で消す (エラーは閉じるまで残す)。
  useEffect(() => {
    if (flash?.tone !== "info") return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

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
    setOpenNo,
    openNo,
    expandApi,
    enabled: !qa.open && !searchOpen && !settingsOpen,
    navigate,
    openQuickAdd,
    openSearch: () => setSearchOpen(true),
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

  const counts: Counts = useMemo(() => {
    const byName = Object.fromEntries(summaries.map((s) => [s.name, s.taskCount]));
    const inbox = summaries.find((s) => s.inbox);
    return { ...byName, inbox: inbox?.taskCount ?? 0, today: countsData.data?.today ?? 0 };
  }, [summaries, countsData.data]);

  const sidebar = (
    <Sidebar
      active={nav}
      counts={counts}
      projects={summaries}
      syncState="off"
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

  // ---- タスク詳細 ----
  // useProject は名前が変わった直後の 1 描画だけ前のプロジェクトの view を持つので、名前で確かめる
  const openTask = view && view.project.name === current && openNo !== null ? view.tasks.find((t) => t.no === openNo) : undefined;
  const panel =
    projectScreen && view && openTask ? (
      <TaskDetailPanel
        key={`${current}/${openTask.no}`}
        task={openTask}
        subtasks={view.tasks.filter((t) => t.parentNo === openTask.no).sort((a, b) => a.order - b.order)}
        project={view.project}
        section={openTask.category ?? undefined}
        today={today}
        onClose={() => setOpenNo(null)}
        onChange={(patch) => p.updateTask(openTask.no, patch)}
        onToggleDone={(done) => void p.completeTask(openTask.no, done)}
        onDelete={() => {
          setOpenNo(null);
          void p.deleteTask(openTask.no);
        }}
        onParseRecurrence={api.parseRecurrence}
        onAddSubtask={(title) => void p.addSubtask(openTask.no, title)}
        onToggleSubtask={(no, done) => void p.completeTask(no, done)}
      />
    ) : undefined;

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
        onToggleDone={cross.toggleDone}
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
        onToggleDone={cross.toggleDone}
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
        onToggleDone={cross.toggleDone}
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
        onToggleDone={(t, done) => void p.completeTask(t.no, done)}
        onAddTask={(section, title) => void p.addTask({ title, section })}
        onAddSubtask={(parent, title) => void p.addSubtask(parent.no, title)}
        onDeleteTask={(t) => {
          if (openNo === t.no) setOpenNo(null);
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
      saveErrors={saveErrors}
      onRetrySave={(project) => void api.retrySave(project).catch(() => undefined)}
      readFailures={readFailures}
      held={ext.held}
      heldFileName={heldFileName}
      onResolve={(project, choice) => void ext.resolve(project, choice)}
      invalidCount={invalidCount}
      onReveal={reveal}
      onReload={() => void reloadProject()}
      notice={p.notice}
      onClearNotice={p.clearNotice}
      flash={flash}
      onClearFlash={() => setFlash(null)}
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
              transition={t(0.25)}
              style={{ flex: "0 0 280px", width: 280, height: "100%" }}
            >
              {sidebar}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
        onToggleDone={(h, done) => void cross.toggleDone(h.task, done).then(() => search.refresh())}
        onClose={() => setSearchOpen(false)}
        today={today}
        busy={search.busy}
      />
      {/* 閉じるアニメーションのため常にマウントし open で出し入れする (閉じたときの初期化は SettingsDialog 側) */}
      <SettingsDialog
        open={settingsOpen}
        syncPlaceholder
        initialPane="account"
        onClose={() => setSettingsOpen(false)}
        dataPane={settingsPanes.data}
        accountPane={settingsPanes.account}
      />
    </>
  );

  return (
    <AppShell
      width={width}
      fill
      syncState="off"
      sidebar={sidebar}
      rail={{
        onExpand: () => setDrawer(true),
        onAddTask: openQuickAdd,
        onNavigate: (t) => {
          if (t === "search") setSearchOpen(true);
          else navigate({ kind: t });
        },
      }}
      banner={banner}
      panel={panel}
      overlay={overlay}
    >
      {body}
    </AppShell>
  );
}
