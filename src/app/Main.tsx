import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, errorMessage, isAppError } from "../api/client";
import { confirmAction, confirmDiscard } from "../api/dialogs";
import type { Counts } from "../mock/data";
import type { AppStateDto, ProjectSummary, QuickAddResult } from "../types/model";
import { Collapse, useMotionTiming } from "../motion";
import { AppShell } from "../views/AppShell";
import { EmptyState } from "../views/EmptyState";
import { FixBanner } from "../views/FixBanner";
import { ProjectView } from "../views/ProjectView";
import { QuickAddDialog } from "../views/QuickAddDialog";
import { SettingsDialog } from "../views/SettingsDialog";
import { Sidebar } from "../views/Sidebar";
import type { SidebarProps } from "../views/Sidebar";
import { TaskDetailPanel } from "../views/TaskDetailPanel";
import { useShellWidth, useToday } from "./hooks";
import { isImeKey } from "./keys";
import { useEscLayer } from "./layers";
import { spansToTokens } from "./quickAddTokens";
import { NoticeBanner, SaveBanner } from "./SaveBanner";
import { useProject } from "./useProject";
import { useSaveErrors } from "./useSaveStatus";
import { useSettingsPanes } from "./useSettingsPanes";

type Nav = SidebarProps["active"];
type Flash = { text: string; tone: "error" | "info" };
type QuickAddState = { open: boolean; text: string; busy: boolean; error?: string; parsed?: { text: string; result: QuickAddResult } };

const QA_CLOSED: QuickAddState = { open: false, text: "", busy: false };
/** 新しいプロジェクトの色は順番に割り当てる (色の選択 UI は Phase 1 では出さない)。 */
const PALETTE = [
  "var(--color-priority-3)",
  "var(--color-success)",
  "var(--color-priority-2)",
  "var(--color-priority-4)",
  "var(--color-priority-1)",
];
const PHASE2_TITLE: Record<string, string> = { today: "今日", upcoming: "近日", labels: "フィルターとラベル" };

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

  const refreshSummaries = useCallback(async () => {
    try {
      setSummaries(await api.listProjects());
    } catch {
      // サイドバーの件数が古いままになるだけ。次の操作でまた更新する。
    }
  }, []);

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

  const placeholder = nav.kind === "today" || nav.kind === "upcoming" || nav.kind === "labels";
  const current = nav.kind === "project" && nav.name ? nav.name : app.inbox;
  const p = useProject(current, { onMutated: refreshSummaries });
  const view = p.view;
  const { reduced, t } = useMotionTiming();

  const showError = useCallback((e: unknown) => setFlash({ text: errorMessage(e), tone: "error" }), []);
  const navigate = useCallback((target: Nav) => {
    setNav(target);
    setOpenNo(null);
    setDrawer(false);
  }, []);
  const openQuickAdd = useCallback(() => setQa((s) => (s.open ? s : { ...QA_CLOSED, open: true })), []);
  const closeQuickAdd = useCallback(() => setQa(QA_CLOSED), []);

  // 情報メッセージは数秒で消す (エラーは閉じるまで残す)。
  useEffect(() => {
    if (flash?.tone !== "info") return;
    const id = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(id);
  }, [flash]);

  // q: クイック追加 (入力欄にフォーカスがあるとき、修飾キー付き、IME 変換中は除く)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // isImeKey: see keys.ts (WebKit's committing keydown arrives with isComposing false but keyCode 229)
      if (e.key.toLowerCase() !== "q" || e.metaKey || e.ctrlKey || e.altKey || isImeKey(e) || settingsOpen) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      openQuickAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd, settingsOpen]);

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
    } catch (e) {
      showError(e);
    }
  };

  // データフォルダが変わった: 開いていたプロジェクトは新しいフォルダに無いかもしれないので、受信トレイに戻して読み直す。
  // 古いフォルダの保存失敗 / 通知の帯はもう当てはまらないので消す。
  const dataDirChanged = () => {
    clearSaveErrors();
    setFlash(null);
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
  const retryLoad = () => void p.reload().catch(() => undefined);

  // 「再読み込み」(FixBanner): 未保存の変更があると reload_project は `unsaved` で断る。確認できたら破棄して読み直す。
  // window.confirm は dialog プラグインが非同期版に置き換えるので使わない (src/api/dialogs.ts)。
  const reloadProject = async () => {
    try {
      await p.reload();
    } catch (e) {
      if (!isAppError(e) || e.kind !== "unsaved") return;
      const ok = await confirmDiscard("未保存の変更を破棄して読み直しますか？", "再読み込み").catch(() => false);
      if (ok) await p.reload(true).catch(() => undefined);
    }
  };

  const counts: Counts = useMemo(() => {
    const byName = Object.fromEntries(summaries.map((s) => [s.name, s.taskCount]));
    const inbox = summaries.find((s) => s.inbox);
    return { ...byName, inbox: inbox?.taskCount ?? 0, today: 0 }; // 今日の件数は Phase 2
  }, [summaries]);

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
  const openTask = view && openNo !== null ? view.tasks.find((t) => t.no === openNo) : undefined;
  const panel =
    !placeholder && view && openTask ? (
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
  if (placeholder) {
    body = <EmptyState title={PHASE2_TITLE[nav.kind]} message="Phase 2 で実装" hideAction />;
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
    body = <div style={{ padding: "var(--space-6) 0", color: "var(--color-text-secondary)", fontSize: 14 }}>読み込み中…</div>;
  } else {
    body = (
      <ProjectView
        key={current}
        project={current}
        tasks={view.tasks}
        sections={view.sections}
        today={today}
        invalidRows={view.invalidRows}
        onOpenTask={(t) => setOpenNo(t.no)}
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

  const invalidCount = !placeholder && !p.error && view ? view.invalidRows.length : 0;
  // 帯は上から 8px 降りてくる + フェードで出て、消えるときはフェードしながら畳む (150ms)。最初の描画では動かさない。
  const banner = (
    <AnimatePresence initial={false}>
      {/* retry_save の失敗は save-status イベントでこの帯に出るので、catch は握りつぶすだけ (二重表示しない) */}
      {Object.entries(saveErrors).map(([project, message]) => (
        <Collapse key={`save-${project}`} duration={0.15} enterY={-8}>
          <SaveBanner message={message} onRetry={() => void api.retrySave(project).catch(() => undefined)} />
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
          if (t !== "search") navigate({ kind: t });
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
