import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage, isAppError } from "../api/client";
import { confirmAction, confirmDiscard } from "../api/dialogs";
import { onProjectChanged, onProjectsChanged, onWatchFailed } from "../api/events";
import type { Counts } from "../mock/data";
import type { AppStateDto, CountsDto, LabelsDto, LabelViewDto, ProjectSummary, QuickAddResult, Task, TodayViewDto, UpcomingDto } from "../types/model";
import { Collapse, useMotionTiming } from "../motion";
import { AppShell } from "../views/AppShell";
import { ExternalChangeBanner } from "../views/ExternalChangeBanner";
import { FixBanner } from "../views/FixBanner";
import { ProjectView } from "../views/ProjectView";
import { QuickAddDialog } from "../views/QuickAddDialog";
import { SearchDialog } from "../views/SearchDialog";
import { SettingsDialog } from "../views/SettingsDialog";
import { taskKey } from "../views/crossList";
import type { ExpandApi } from "../views/ProjectView";
import { LabelDetailView } from "../views/LabelDetailView";
import { LabelsView } from "../views/LabelsView";
import { Sidebar } from "../views/Sidebar";
import type { SidebarProps } from "../views/Sidebar";
import { TaskDetailPanel } from "../views/TaskDetailPanel";
import { TodayView } from "../views/TodayView";
import { UpcomingView } from "../views/UpcomingView";
import { useShellWidth, useToday } from "./hooks";
import { addDays } from "./dates";
import { setEscFallback, useEscLayer } from "./layers";
import { spansToTokens } from "./quickAddTokens";
import { NoticeBanner, SaveBanner } from "./SaveBanner";
import type { RowHandlers } from "./shortcuts";
import { useShortcuts } from "./shortcuts";
import { useCrossActions, useCrossView } from "./useCrossView";
import { heldFileName, useExternalChanges, useExternalReadFailures } from "./useExternalChanges";
import { useProject } from "./useProject";
import { useRowFocus } from "./useRowFocus";
import { useSearch } from "./useSearch";
import { useSaveErrors } from "./useSaveStatus";
import { useSettingsPanes } from "./useSettingsPanes";

type Nav = SidebarProps["active"];
type Flash = { text: string; tone: "error" | "info" };
type QuickAddState = { open: boolean; text: string; busy: boolean; error?: string; parsed?: { text: string; result: QuickAddResult } };

const QA_CLOSED: QuickAddState = { open: false, text: "", busy: false };
/** 新しいラベルの色 (既定、仕様 §3.3)。ラベルの「色」メニューの先頭にも出し、既定に戻せるようにする。 */
const DEFAULT_LABEL_COLOR = "var(--color-text-muted)";
/** 新しいプロジェクトの色は順番に割り当てる。ラベルの「色」メニューの候補はこれに既定色を足したもの。 */
const PALETTE = [
  "var(--color-priority-3)",
  "var(--color-success)",
  "var(--color-priority-2)",
  "var(--color-priority-4)",
  "var(--color-priority-1)",
];
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
  const [qa, setQa] = useState<QuickAddState>(QA_CLOSED);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // キーボードのフォーカス行: 画面に出ている行のキー (表示順) は各ビューが知らせる。ナビゲーションで外れる。
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const reportKeys = useCallback(
    (keys: string[]) => setVisibleKeys((prev) => (prev.length === keys.length && prev.every((k, i) => k === keys[i]) ? prev : keys)),
    [],
  );
  const focus = useRowFocus(visibleKeys);
  const clearFocus = focus.clear;
  const expandApi = useRef<ExpandApi | null>(null);
  const search = useSearch(searchOpen);
  const [searchSel, setSearchSel] = useState(0);
  // 選択位置: 開くとき / 検索条件が変わったときは先頭、結果が入れ替わっただけ (チェック後の再取得) なら範囲内に収める。
  useEffect(() => {
    if (searchOpen) setSearchSel(0);
  }, [searchOpen]);
  useEffect(() => setSearchSel((s) => Math.min(s, Math.max(search.hits.length - 1, 0))), [search.hits]);

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
  const p = useProject(current, { onMutated: refreshSummaries });
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

  // ---- 横断ビュー (今日 / 近日 / ラベル詳細): 表示中のビューだけ取得する ----
  const inactive = () => Promise.resolve(null);
  const todayData = useCrossView<TodayViewDto | null>(nav.kind === "today" ? () => api.todayView(today) : inactive, [nav.kind === "today", today]);
  const [upFrom, setUpFrom] = useState(today);
  const [upDays, setUpDays] = useState(7);
  useEffect(() => {
    if (nav.kind !== "upcoming") {
      setUpFrom(today);
      setUpDays(7);
    }
  }, [nav.kind, today]);
  const upcomingData = useCrossView<UpcomingDto | null>(
    nav.kind === "upcoming" ? () => api.upcomingView(upFrom, upDays) : inactive,
    [nav.kind === "upcoming", upFrom, upDays],
  );
  // 「さらに 7 日」や月ジャンプで取り直す間は、前のグループを出したままにする (空表示と先頭へのスクロールを避ける)。
  const lastUpcoming = useRef<UpcomingDto | null>(null);
  if (nav.kind !== "upcoming") lastUpcoming.current = null;
  else if (upcomingData.data) lastUpcoming.current = upcomingData.data;
  const labelName = nav.kind === "label" ? nav.name : undefined;
  const labelData = useCrossView<LabelViewDto | null>(labelName ? () => api.labelView(labelName) : inactive, [labelName]);
  const labelsData = useCrossView<LabelsDto | null>(nav.kind === "labels" ? () => api.labels() : inactive, [nav.kind === "labels"]);
  const refreshAll = () => {
    todayData.refresh();
    upcomingData.refresh();
    labelData.refresh();
    void refreshSummaries(); // 件数 (今日 / プロジェクト) も更新する
  };
  const cross = useCrossActions(refreshAll, showError, app.inbox);
  /** 横断ビューのタスクを、そのプロジェクトの画面で詳細パネルつきで開く。navigate が openNo を消すので、その後に設定する。 */
  const openCross = (t: Task) => {
    navigate(t.project === app.inbox ? { kind: "inbox" } : { kind: "project", name: t.project });
    setOpenNo(t.no);
  };
  const openQuickAdd = useCallback(() => setQa((s) => (s.open ? s : { ...QA_CLOSED, open: true })), []);
  const closeQuickAdd = useCallback(() => setQa(QA_CLOSED), []);

  // 情報メッセージは数秒で消す (エラーは閉じるまで残す)。
  useEffect(() => {
    if (flash?.tone !== "info") return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  // ---- キーボード操作 (shortcuts.ts)。フォーカス行のタスクは、いま出ているビューのデータから探す ----
  const focusedTask = (() => {
    const k = focus.focusedKey;
    if (k === null) return undefined;
    const pool: Task[] =
      nav.kind === "today"
        ? [...(todayData.data?.overdue ?? []), ...(todayData.data?.today ?? [])]
        : nav.kind === "upcoming"
          ? (lastUpcoming.current?.days.flatMap((d) => d.tasks) ?? [])
          : nav.kind === "label"
            ? (labelData.data?.tasks ?? [])
            : projectScreen && view && view.project.name === current
              ? view.tasks
              : [];
    return pool.find((t) => taskKey(t) === k);
  })();
  /** そのプロジェクトの画面に出ている行か (useProject 経由で更新する) 。今日 / 近日 / ラベルの行は cross 経由。 */
  const onProjectScreen = (t: Task) => projectScreen && t.project === current;
  const actOn = {
    toggleDone: (t: Task) => (onProjectScreen(t) ? void p.completeTask(t.no, t.progress !== 100) : void cross.toggleDone(t, t.progress !== 100)),
    setPriority: (t: Task, priority: 1 | 2 | 3 | 4) =>
      onProjectScreen(t) ? void p.updateTask(t.no, { priority }) : void cross.setPriority(t, priority),
    // dueTime は触らない (時刻は保つ)
    setDue: (t: Task, due: string) => (onProjectScreen(t) ? void p.updateTask(t.no, { due }) : void cross.setDue(t, due)),
  };
  const deleteAny = async (t: Task) => {
    // プロジェクト画面は実際に子があるときだけ。横断ビューは子を一覧に出さないので、親タスクなら常に添える。
    const hasSubtasks = onProjectScreen(t) ? !!view?.tasks.some((x) => x.parentNo === t.no) : t.parentNo === undefined;
    const ok = await confirmAction(`「${t.title}」を削除します。${hasSubtasks ? "サブタスクも削除されます。" : ""}`, {
      title: "タスクの削除",
      okLabel: "削除",
    }).catch(() => false);
    if (!ok) return;
    if (onProjectScreen(t)) {
      if (openNo === t.no) setOpenNo(null);
      void p.deleteTask(t.no);
    } else {
      void cross.remove(t);
    }
  };
  const openAny = (t: Task) => {
    if (onProjectScreen(t)) {
      setOpenNo(t.no);
      focus.set(taskKey(t));
    } else {
      openCross(t);
    }
  };
  const row: RowHandlers | null = visibleKeys.length
    ? {
        hasFocus: !!focusedTask,
        up: () => focus.move(-1),
        down: () => focus.move(1),
        open: () => focusedTask && openAny(focusedTask),
        toggleDone: () => focusedTask && actOn.toggleDone(focusedTask),
        remove: () => focusedTask && void deleteAny(focusedTask),
        setPriority: (pr) => focusedTask && actOn.setPriority(focusedTask, pr),
        dueToday: () => focusedTask && actOn.setDue(focusedTask, today),
        dueTomorrow: () => focusedTask && actOn.setDue(focusedTask, addDays(today, 1)),
        expand: () => focusedTask && expandApi.current?.expand(focusedTask.no),
        collapse: () => focusedTask && expandApi.current?.collapse(focusedTask.no),
        clear: focus.clear,
      }
    : null;
  useShortcuts({
    quickAdd: openQuickAdd,
    search: () => setSearchOpen(true),
    goToday: () => navigate({ kind: "today" }),
    goUpcoming: () => navigate({ kind: "upcoming" }),
    goInbox: () => navigate({ kind: "inbox" }),
    goLabels: () => navigate({ kind: "labels" }),
    row,
    enabled: !qa.open && !searchOpen && !settingsOpen,
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

  // クイック追加のプレビュー: 入力が止まってから parse_quick_add を呼ぶ。結果は解析した文字列とセットで持つ。
  useEffect(() => {
    if (!qa.open || !qa.text.trim()) return;
    const text = qa.text;
    let cancelled = false;
    const id = window.setTimeout(() => {
      p.parseQuickAdd(text)
        .then((result) => {
          if (!cancelled) setQa((s) => (s.text === text ? { ...s, parsed: { text, result } } : s));
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [qa.open, qa.text, p.parseQuickAdd]);

  const submitQuickAdd = async (text: string) => {
    setQa((s) => ({ ...s, busy: true, error: undefined }));
    try {
      const out = await p.quickAdd(text);
      setQa(QA_CLOSED);
      if (out.view.project.name !== current) setFlash({ text: `「${out.view.project.name}」に追加しました`, tone: "info" });
    } catch (e) {
      setQa((s) => ({ ...s, busy: false, error: errorMessage(e) }));
    }
  };

  const createProject = async (name: string) => {
    try {
      const color = PALETTE[summaries.filter((s) => !s.inbox).length % PALETTE.length];
      const created = await api.createProject(name, color);
      await refreshSummaries();
      navigate({ kind: "project", name: created.name });
    } catch (e) {
      showError(e);
    }
  };

  // ---- プロジェクトの改名 / 削除 (受信トレイは不可) ----
  const renameProject = async (newName: string) => {
    try {
      const renamed = await api.renameProject(current, newName);
      await refreshSummaries();
      navigate({ kind: "project", name: renamed.name });
    } catch (e) {
      showError(e);
    } finally {
      // 保留中のプロジェクトは新しい名前で保留され直す (共通設定が保留になることもある)
      void ext.refresh();
    }
  };

  const deleteProject = async () => {
    const ok = await confirmAction(`プロジェクト「${current}」を削除します (archive フォルダに移動)。`, {
      title: "プロジェクトの削除",
      okLabel: "削除",
    }).catch(() => false);
    if (!ok) return;
    try {
      await api.deleteProject(current);
      await refreshSummaries();
      navigate({ kind: "inbox" });
      void ext.refresh();
    } catch (e) {
      showError(e);
    }
  };

  const deleteLabel = async (name: string) => {
    const ok = await confirmAction(`ラベル「${name}」を削除します。付いているタスクからも外れます。`, {
      title: "ラベルの削除",
      okLabel: "削除",
    }).catch(() => false);
    if (!ok) return;
    try {
      await api.deleteLabel(name);
      labelsData.refresh();
    } catch (e) {
      showError(e);
    }
  };

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

  // ---- クイック追加ダイアログに渡すもの ----
  const parsed = qa.parsed && qa.parsed.text === qa.text ? qa.parsed.result : undefined;
  const tokens = parsed ? spansToTokens(qa.text, parsed.spans) : qa.text ? [{ text: qa.text }] : [];
  const qaProject = parsed?.project ?? current;
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
  // 帯は上から 8px 降りてくる + フェードで出て、消えるときはフェードしながら畳む (150ms)。最初の描画では動かさない。
  const banner = (
    <AnimatePresence initial={false}>
      {/* retry_save の失敗は save-status イベントでこの帯に出るので、catch は握りつぶすだけ (二重表示しない) */}
      {Object.entries(saveErrors).map(([project, message]) => (
        <Collapse key={`save-${project}`} duration={0.15} enterY={-8}>
          <SaveBanner message={message} onRetry={() => void api.retrySave(project).catch(() => undefined)} />
        </Collapse>
      ))}
      {Object.entries(readFailures.failures).map(([project, message]) => (
        <Collapse key={`read-${project}`} duration={0.15} enterY={-8}>
          <NoticeBanner
            message={`「${project === "_common" ? "共通設定" : project}」の Excel の変更を読み込めません: ${message}`}
            onDismiss={() => readFailures.dismiss(project)}
          />
        </Collapse>
      ))}
      {ext.held.map((project) => (
        <Collapse key={`ext-${project}`} duration={0.15} enterY={-8}>
          <ExternalChangeBanner
            fileName={heldFileName(project)}
            onReload={() => void ext.resolve(project, "reload")}
            onOverwrite={() => void ext.resolve(project, "overwrite")}
          />
        </Collapse>
      ))}
      {invalidCount > 0 && (
        <Collapse key="fix" duration={0.15} enterY={-8}>
          <FixBanner
            message={`${invalidCount} 行に型の不整合があります。Excel で修正するまで、その行はアプリから編集できません。修正したら「再読み込み」を押してください。`}
            onOpenExcel={reveal}
            onReload={() => void reloadProject()}
          />
        </Collapse>
      )}
      {p.notice && (
        <Collapse key="notice" duration={0.15} enterY={-8}>
          <NoticeBanner message={p.notice} onDismiss={p.clearNotice} />
        </Collapse>
      )}
      {flash && (
        <Collapse key="flash" duration={0.15} enterY={-8}>
          <NoticeBanner message={flash.text} tone={flash.tone} onDismiss={() => setFlash(null)} />
        </Collapse>
      )}
    </AnimatePresence>
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
        onChangeText={(text) => setQa((s) => ({ ...s, text, error: undefined }))}
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
        onToggleDone={(h, done) =>
          void api
            .completeTask(h.task.project, h.task.no, done)
            .then(() => {
              search.refresh();
              refreshAll();
            })
            .catch(showError)
        }
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
