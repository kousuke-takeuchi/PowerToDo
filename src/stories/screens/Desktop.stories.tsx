import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { addDays } from "../../app/dates";
import type { DayGroup, Task } from "../../types/model";
import { TODAY, comments, counts, filters, labelCounts, labels, projects, sections, tasks } from "../../mock/data";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "../../components/Button";
import { TaskRow } from "../../components/TaskRow";
import { Toast } from "../../components/Toast";
import { RowActions, type RowActionsApi } from "../../app/rowActions";
import { DragProvider, type DropResult } from "../../app/drag/DragContext";
import { DeleteTaskDialog } from "../../views/DeleteTaskDialog";
import { countDescendants } from "../../views/deleteMessage";
import { AppShell } from "../../views/AppShell";
import { BoardView } from "../../views/BoardView";
import { ConflictBanner } from "../../views/ConflictBanner";
import { FixBanner } from "../../views/FixBanner";
import { LabelDetailView } from "../../views/LabelDetailView";
import { LabelsView } from "../../views/LabelsView";
import { Onboarding } from "../../views/Onboarding";
import { OsNotification } from "../../views/OsNotification";
import { ProjectView } from "../../views/ProjectView";
import { QuickAddDialog } from "../../views/QuickAddDialog";
import type { ProjectViewProps } from "../../views/ProjectView";
import { SettingsDialog } from "../../views/SettingsDialog";
import type { SyncTarget } from "../../views/SettingsDialog";
import { Sidebar } from "../../views/Sidebar";
import type { SidebarProps } from "../../views/Sidebar";
import { SyncSamples } from "../../views/SyncSamples";
import { TaskDialog } from "../../views/TaskDialog";
import type { TaskDialogProps } from "../../views/TaskDialog";
import type { SyncState } from "../../components/SyncStatus";
import { DEFAULTS } from "../../app/view/viewOptions";
import { TodayView } from "../../views/TodayView";
import { UpcomingView } from "../../views/UpcomingView";

const meta = {
  title: "Screens/Desktop",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// pen の「買い物」プロジェクトは 今週 に 2 件 (牛乳と卵を買う / 洗剤の詰め替え)。
// mock の「食パンを買う」(no 8) は D-04 今日 用なので、プロジェクト画面の Story からは外す。
const shopping = tasks.filter((t) => t.no !== 8);
// D-11c (要修正行) と D-13 は件数バッジとシェブロンを出さない (pen どおり)。
const shoppingFlat = shopping.filter((t) => t.parentNo === undefined);

const sidebar = (
  <Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="synced" lastSyncedAt="09:41" />
);

function Screen({ width, banner, ...view }: Partial<ProjectViewProps> & { width?: 1440 | 960; banner?: React.ReactNode }) {
  return (
    <AppShell width={width} sidebar={sidebar} syncState="synced" banner={banner}>
      <ProjectView project="買い物" tasks={shopping} sections={sections} {...view} />
    </AppShell>
  );
}

export const D01: Story = {
  name: "D-01 プロジェクト",
  render: () => <Screen showLongTitleRow />,
};

export const D01s: Story = {
  name: "D-01s 「表示」メニュー",
  render: () => <Screen initialViewMenuOpen initialView={{ ...DEFAULTS, sort: "priority", group: "label", date: "7d" }} />,
};

export const D01h: Story = {
  name: "D-01h 行にマウスを乗せる",
  render: () => <Screen hoverNo={1} />,
};

export const D01i: Story = {
  name: "D-01i 行の編集欄",
  render: () => <Screen initialEditNo={2} />,
};

export const D01j: Story = {
  name: "D-01j タスクを追加の欄",
  render: () => <Screen initialAddSection={null} />,
};

export const D01k: Story = {
  name: "D-01k 「…」のメニュー",
  render: () => <Screen hoverNo={2} initialMenuNo={2} />,
};

export const D01l: Story = {
  name: "D-01l 行の日付の選択",
  render: () => <Screen hoverNo={2} initialDateNo={2} />,
};

export const D01m: Story = {
  name: "D-01m 削除の確認",
  render: () => <Screen initialDeleteNo={1} />,
};

export const D01n: Story = {
  name: "D-01n ドラッグ中 (並べ替え)",
  render: () => <Screen dragPreview={{ no: 1, kind: "between", targetNo: 2 }} />,
};

export const D01o: Story = {
  name: "D-01o ドラッグ中 (字下げ)",
  render: () => <Screen dragPreview={{ no: 2, kind: "indent", targetNo: 1 }} />,
};

export const D01p: Story = {
  name: "D-01p ドラッグ中 (行に重ねる)",
  render: () => <Screen dragPreview={{ no: 1, kind: "onto", targetNo: 2 }} />,
};

export const D01q: Story = {
  name: "D-01q セクションの並べ替え",
  render: () => <Screen sectionDragPreview="いつか" />,
};

// Story only: the card floats where the pointer is (no engine). Same look as the drag card.
const previewCard = (title: string, style: React.CSSProperties) => (
  <div
    aria-hidden
    style={{ position: "fixed", zIndex: 50, pointerEvents: "none", background: "var(--color-bg)", borderRadius: 6, boxShadow: "var(--shadow-popover)", ...style }}
  >
    <TaskRow title={title} done={false} priority={3} hideActions />
  </div>
);

export const D01r: Story = {
  name: "D-01r ドラッグ中 (左の一覧に重ねる)",
  render: () => (
    <>
      <AppShell
        sidebar={<Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="synced" lastSyncedAt="09:41" dropPreview="仕事" />}
        syncState="synced"
      >
        <ProjectView project="買い物" tasks={shopping} sections={sections} dragPreview={{ no: 2, kind: "between", targetNo: 0 }} />
      </AppShell>
      {previewCard("洗剤の詰め替え", { left: 150, top: 215, width: 420 })}
    </>
  ),
};

export const D01b: Story = {
  name: "D-01b サブタスク展開",
  render: () => <Screen initialExpanded={[1, 5]} />,
};

export const D01c: Story = {
  name: "D-01c サブタスク追加フォーム",
  render: () => <Screen initialExpanded={[1, 5]} initialFormParent={1} />,
};

// 操作確認用 (アニメーション): タスクの追加 (セクション末尾の「タスクを追加」) / 完了 (チェック) / 削除 (行の「その他」) / サブタスク追加が
// この Story の中のローカル state で動く。完了にすると 400ms 後に行が畳まれて消える。サイドバーの「タスクを追加」でクイック追加も開く。
function InteractiveScreen() {
  const [list, setList] = useState<Task[]>(shopping);
  const [qa, setQa] = useState(false);
  const [text, setText] = useState("");
  const nextNo = (cur: Task[]) => Math.max(0, ...cur.map((t) => t.no)) + 1;
  const append = (title: string, section: string | null, parentNo?: number) =>
    setList((cur) => {
      const siblings = cur.filter((t) => t.parentNo === parentNo && (parentNo !== undefined || t.category === section));
      const base = cur.find((t) => t.no === parentNo);
      return [
        ...cur,
        {
          no: nextNo(cur),
          project: "買い物",
          category: base ? base.category : section,
          title,
          assignee: "たろう",
          priority: 4,
          progress: 0,
          parentNo,
          labels: [],
          reminders: [],
          order: Math.max(-1, ...siblings.map((t) => t.order)) + 1,
          createdAt: "2026-10-13T09:00",
        },
      ];
    });
  return (
    <AppShell
      sidebar={
        <Sidebar
          active={{ kind: "project", name: "買い物" }}
          counts={counts}
          projects={projects}
          syncState="synced"
          lastSyncedAt="09:41"
          onAddTask={() => setQa(true)}
        />
      }
      syncState="synced"
      overlay={
        <QuickAddDialog
          open={qa}
          tokens={text ? [{ text }] : []}
          project="買い物"
          projectColor={shoppingColor}
          text={text}
          onChangeText={setText}
          onSubmit={(t) => {
            append(t.trim(), "今週");
            setText("");
            setQa(false);
          }}
          onClose={() => setQa(false)}
        />
      }
    >
      <ProjectView
        project="買い物"
        tasks={list}
        sections={sections}
        initialExpanded={[1]}
        onToggleDone={(t, done) => setList((cur) => cur.map((x) => (x.no === t.no ? { ...x, progress: done ? 100 : 0 } : x)))}
        onAddTask={(section, title) => append(title, section)}
        onAddSubtask={(parent, title) => append(title, parent.category, parent.no)}
        onDeleteTask={(t) => setList((cur) => cur.filter((x) => x.no !== t.no && x.parentNo !== t.no))}
      />
    </AppShell>
  );
}

export const D01Interactive: Story = {
  name: "D-01 追加と完了 (操作)",
  render: () => <InteractiveScreen />,
};

// 操作確認用 (spec ②): 行の鉛筆 / 日付 / 「…」/ 追加の欄が、この Story の中のローカル state で動く (RowActions の代わり)。
function RowActionsScreen() {
  const [list, setList] = useState<Task[]>(shopping);
  const [editing, setEditing] = useState<string | null>(null);
  const [inserting, setInserting] = useState<RowActionsApi["inserting"]>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const nextNo = (cur: Task[]) => Math.max(0, ...cur.map((t) => t.no)) + 1;
  const patch = (no: number, p: Partial<Task>) => setList((cur) => cur.map((x) => (x.no === no ? { ...x, ...p } : x)));
  const ctx: RowActionsApi = {
    today: TODAY,
    inbox: "受信トレイ",
    projects: projects.map((p) => ({ name: p.name, sections: p.name === "買い物" ? sections.filter((s) => s.project === "買い物").map((s) => s.name) : [] })),
    allLabels: labels.map((l) => l.name),
    editing,
    setEditing,
    inserting,
    setInserting,
    overlay,
    setOverlay,
    save: async (t, _before, after) => {
      patch(t.no, { title: after.title.trim(), note: after.note || undefined, due: after.due, dueTime: after.dueTime, priority: after.priority, labels: after.labels, category: after.section });
      return true;
    },
    add: async (v, opts) => {
      const no = nextNo(list);
      setList((cur) => {
        const anchor = opts?.position ? cur.find((x) => x.no === ("before" in opts.position! ? opts.position.before : opts.position!.after)) : undefined;
        const at = anchor ? ("before" in opts!.position! ? anchor.order : anchor.order + 1) : Math.max(0, ...cur.map((x) => x.order)) + 1;
        const shifted = anchor ? cur.map((x) => (x.category === anchor.category && x.parentNo === anchor.parentNo && x.order >= at ? { ...x, order: x.order + 1 } : x)) : cur;
        return [...shifted, { no, project: "買い物", category: v.section, title: v.title.trim(), assignee: "たろう", priority: v.priority, progress: 0, due: v.due, parentNo: opts?.parentNo, labels: v.labels, reminders: [], order: at, createdAt: "2026-10-13T09:00" }];
      });
      setToast(`タスクが ${v.project} に追加されました`);
      return no;
    },
    setDue: (t, due) => {
      patch(t.no, { due });
      setToast(due ? `日付を ${due} に更新しました` : "日付を削除しました");
    },
    setPriority: (t, pr) => patch(t.no, { priority: pr }),
    setReminders: (t, r) => patch(t.no, { reminders: r }),
    move: (t, _project, section) => patch(t.no, { category: section }),
    duplicate: (t) => {
      setList((cur) => [...cur.map((x) => (x.category === t.category && x.parentNo === t.parentNo && x.order > t.order ? { ...x, order: x.order + 1 } : x)), { ...t, no: nextNo(cur), order: t.order + 1 }]);
      setToast("タスクを複製しました");
    },
    requestDelete: setDeleting,
    openComments: () => setToast("コメントを開く"),
  };
  return (
    <RowActions.Provider value={ctx}>
      <AppShell
        sidebar={sidebar}
        syncState="synced"
        overlay={
          <>
            {toast && <Toast text={toast} onAction={() => setToast(null)} onClose={() => setToast(null)} />}
            {deleting && (
              <DeleteTaskDialog
                title={deleting.title}
                subtasks={countDescendants(list, deleting.no)}
                onCancel={() => setDeleting(null)}
                onConfirm={() => {
                  setList((cur) => cur.filter((x) => x.no !== deleting.no && x.parentNo !== deleting.no));
                  setDeleting(null);
                }}
              />
            )}
          </>
        }
      >
        <ProjectView project="買い物" tasks={list} sections={sections} initialExpanded={[1]} onToggleDone={(t, done) => patch(t.no, { progress: done ? 100 : 0 })} />
      </AppShell>
    </RowActions.Provider>
  );
}

export const D01RowActions: Story = {
  name: "D-01 行の操作 (操作)",
  render: () => <RowActionsScreen />,
};

// 操作確認用 (spec ③): ドラッグの本体を DragProvider でつなぎ、drop をローカル state に反映する。ハンドルは Task 4 以降で行に付く。
function DragScreen() {
  const [list, setList] = useState<Task[]>(shopping);
  const [secs, setSecs] = useState(sections);
  const [projs, setProjs] = useState(projects);
  // The last drops that left the project screen (a task onto a sidebar project, a project order), shown below the sidebar for the check.
  const [log, setLog] = useState<string[]>([]);
  const onDrop = (r: DropResult) => {
    if (r.kind === "project") {
      if (r.project !== r.source.task.project) setLog((l) => [...l, `project:${r.source.task.no}->${r.project}`]);
    } else if (r.kind === "projects") {
      setProjs((cur) => r.names.map((n, i) => ({ ...cur.find((p) => p.name === n)!, order: i + 1 })).concat(cur.filter((p) => p.inbox)));
      setLog((l) => [...l, `projects:${r.names.join(",")}`]);
    } else if (r.kind === "place") {
      const { section, parent, before } = r.placement;
      setList((cur) => {
        const moved = { ...r.source.task, category: section, parentNo: parent ?? undefined };
        const sibs = cur.filter((t) => t.no !== moved.no && t.category === section && (t.parentNo ?? null) === parent).sort((a, b) => a.order - b.order);
        const at = before === null ? sibs.length : Math.max(0, sibs.findIndex((t) => t.no === before));
        const ordered = [...sibs.slice(0, at), moved, ...sibs.slice(at)];
        const orderOf = new Map(ordered.map((t, i) => [t.no, i]));
        return cur.map((t) => (t.no === moved.no ? { ...moved, order: orderOf.get(moved.no)! } : orderOf.has(t.no) ? { ...t, order: orderOf.get(t.no)! } : t));
      });
    } else if (r.kind === "sections") {
      setSecs((cur) => cur.map((s) => (s.project === r.project ? { ...s, order: r.names.indexOf(s.name) } : s)));
    }
  };
  return (
    <DragProvider onDrop={onDrop}>
      <AppShell
        sidebar={<Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projs} syncState="synced" lastSyncedAt="09:41" />}
        syncState="synced"
      >
        <ProjectView project="買い物" tasks={list} sections={secs} initialExpanded={[1]} />
        <div data-testid="drag-log" style={{ position: "fixed", right: 8, bottom: 8, fontSize: 12, color: "var(--color-text-muted)" }}>{log.join(" | ")}</div>
      </AppShell>
    </DragProvider>
  );
}

export const D01Drag: Story = {
  name: "D-01 ドラッグ (操作)",
  render: () => <DragScreen />,
};

// D-02: D-01 の上にクイック追加ダイアログ。キャンセル / scrim / Esc で閉じ、サイドバーの「タスクを追加」で開き直す。
const quickAddTokens = [
  { text: "牛乳と卵を買う " },
  { text: "明日", kind: "date" as const },
  { text: "p1", kind: "priority" as const },
  { text: "#買い物", kind: "project" as const },
  { text: "@食品", kind: "label" as const },
];

const shoppingColor = projects.find((p) => p.name === "買い物")?.color;

function QuickAddScreen() {
  const [open, setOpen] = useState(true);
  return (
    <AppShell
      sidebar={
        <Sidebar
          active={{ kind: "project", name: "買い物" }}
          counts={counts}
          projects={projects}
          syncState="synced"
          lastSyncedAt="09:41"
          onAddTask={() => setOpen(true)}
        />
      }
      syncState="synced"
      overlay={
        <QuickAddDialog
          open={open}
          tokens={quickAddTokens}
          project="買い物"
          projectColor={shoppingColor}
          section="今週"
          onClose={() => setOpen(false)}
        />
      }
    >
      <ProjectView project="買い物" tasks={shopping} sections={sections} />
    </AppShell>
  );
}

export const D02: Story = {
  name: "D-02 クイック追加",
  render: () => <QuickAddScreen />,
};

// D-03 系: pen の詳細パネルは「牛乳と卵を買う」。mock の task 1 に pen 固有の説明文とラベル 2 つを足して渡す
// (D-01 の行は mock のまま。パネルだけ pen に合わせる)。
const detailTask = {
  ...tasks[0],
  note: "近所のスーパーで。卵は 10 個入り。ポイントカードを忘れない。",
  labels: ["食品", "急ぎ"],
};
const detailProject = projects.find((p) => p.name === "買い物")!;

function DetailScreen({
  initialPopover,
  widthPx,
  layout,
  initialCommentEdit,
}: {
  initialPopover?: TaskDialogProps["initialPopover"];
  widthPx?: number;
  layout?: "wide" | "narrow";
  initialCommentEdit?: string;
}) {
  // 行をクリックするとその行のダイアログを開く (pen の詳細は 1 番の行のものだけなので、他の行は mock のまま)。
  const [openNo, setOpenNo] = useState<number | null>(detailTask.no);
  const shown = openNo === null ? undefined : openNo === detailTask.no ? detailTask : tasks.find((t) => t.no === openNo);
  const order = shopping.filter((t) => t.parentNo === undefined).map((t) => t.no);
  const i = shown ? order.indexOf(shown.no) : -1;
  return (
    <AppShell
      width={widthPx && widthPx < 750 ? 960 : 1440}
      widthPx={widthPx}
      sidebar={sidebar}
      syncState="synced"
      overlay={
        shown ? (
          <TaskDialog
            key={shown.no}
            task={shown}
            subtasks={tasks.filter((t) => t.parentNo === shown.no)}
            project={detailProject}
            section={shown.category ?? undefined}
            comments={shown.no === detailTask.no ? comments : []}
            me="たろう"
            onAddComment={() => Promise.resolve(true)}
            onEditComment={() => Promise.resolve(true)}
            onDeleteComment={() => {}}
            initialCommentEdit={initialCommentEdit}
            initialPopover={shown.no === detailTask.no ? initialPopover : undefined}
            layout={layout}
            onClose={() => setOpenNo(null)}
            onPrev={i > 0 ? () => setOpenNo(order[i - 1]) : undefined}
            onNext={i >= 0 && i < order.length - 1 ? () => setOpenNo(order[i + 1]) : undefined}
            projects={projects.map((pj) => ({ name: pj.name, sections: pj.name === "買い物" ? sections.map((x) => x.name) : [] }))}
            onMove={() => setOpenNo(null)}
            allLabels={labels.map((l) => l.name)}
          />
        ) : undefined
      }
    >
      <ProjectView project="買い物" tasks={shopping} sections={sections} onOpenTask={(t) => setOpenNo(t.no)} />
    </AppShell>
  );
}

export const D03: Story = {
  name: "D-03 タスク詳細",
  render: () => <DetailScreen />,
};

export const D03Project: Story = {
  name: "D-03 タスク詳細 (プロジェクトを選ぶ)",
  render: () => <DetailScreen initialPopover="project" />,
};

export const D03Labels: Story = {
  name: "D-03 タスク詳細 (ラベルを選ぶ)",
  render: () => <DetailScreen initialPopover="labels" />,
};

export const D03c: Story = {
  name: "D-03c コメントの編集",
  render: () => <DetailScreen initialCommentEdit="c1" />,
};

export const D03b: Story = {
  name: "D-03b タスク詳細 (狭いウィンドウ)",
  render: () => <DetailScreen widthPx={700} layout="narrow" />,
};

function navShell(active: SidebarProps["active"], children: React.ReactNode, todayCount: number = counts.today) {
  return (
    <AppShell
      sidebar={<Sidebar active={active} counts={{ ...counts, today: todayCount }} projects={projects} syncState="synced" lastSyncedAt="09:41" />}
      syncState="synced"
    >
      {children}
    </AppShell>
  );
}

// pen の今日 / 近日 / ラベル詳細は mock の一部のタスクだけを見せている (pen に合わせて Story 側で絞る)。
// 15 調味料の補充 (D-06b 用) / 13 粗大ごみ / 12 ゴミ出し (D-05 では出ない) を外す。
const withoutNo = (...nos: number[]) => tasks.filter((t) => !nos.includes(t.no));

export const D04: Story = {
  name: "D-04 今日",
  render: () => navShell({ kind: "today" }, <TodayView tasks={withoutNo(15)} today={TODAY} />),
};

// 操作確認用 (横断ビュー): 実アプリと同じく、完了にしたタスクはビュー (Rust の today_view) からすぐ消える側として mock 一覧の progress を更新する。
// 行は TodayView が 400ms だけ完了表示のまま残してから畳む。追加は受信トレイ・期限 = 今日、再スケジュールは期限切れ全件の期限を選んだ日にする。
function TodayInteractive() {
  const [list, setList] = useState<Task[]>(() => withoutNo(15));
  const [log, setLog] = useState<string[]>([]);
  return (
    <DragProvider
      onDrop={(r) => {
        if (r.kind === "today") setLog((l) => [...l, `today:before ${r.beforeKey}`]);
        else if (r.kind === "project" && r.project !== r.source.task.project) setLog((l) => [...l, `project:${r.source.task.no}->${r.project}`]);
      }}
    >
      {navShell(
    { kind: "today" },
    <><div data-testid="drag-log" style={{ position: "fixed", right: 8, bottom: 8, fontSize: 12, color: "var(--color-text-muted)" }}>{log.join(" | ")}</div><TodayView
      tasks={list}
      today={TODAY}
      hiddenProjects={["読書"]}
      onToggleDone={(t, done) => setList((cur) => cur.map((x) => (x.no === t.no ? { ...x, progress: done ? 100 : 0 } : x)))}
      onOpenTask={() => {}}
      onAddTask={(title) =>
        setList((cur) => [
          ...cur,
          {
            no: Math.max(0, ...cur.map((x) => x.no)) + 1,
            project: "受信トレイ",
            category: null,
            title,
            assignee: "たろう",
            priority: 4,
            progress: 0,
            due: TODAY,
            labels: [],
            reminders: [],
            order: 0,
            createdAt: `${TODAY}T09:00`,
          },
        ])
      }
      onReschedule={(due) => setList((cur) => cur.map((x) => (x.due !== undefined && x.due < TODAY ? { ...x, due } : x)))}
    /></>,
      )}
    </DragProvider>
  );
}

export const D04Interactive: Story = {
  name: "D-04 今日 (操作)",
  render: () => <TodayInteractive />,
};

export const D04b: Story = {
  name: "D-04 今日 (期限切れなし)",
  render: () => navShell({ kind: "today" }, <TodayView tasks={withoutNo(15)} today={TODAY} hideOverdue />, 3),
};

export const D05: Story = {
  name: "D-05 近日",
  render: () => navShell({ kind: "upcoming" }, <UpcomingView tasks={withoutNo(12, 13, 15)} today={TODAY} />),
};

export const D05b: Story = {
  name: "D-05b ドラッグ中 (別の日に重ねる)",
  render: () => (
    <>
      {navShell({ kind: "upcoming" }, <UpcomingView tasks={withoutNo(12, 13, 15)} today={TODAY} dropPreviewDay={addDays(TODAY, 2)} />)}
      {previewCard("牛乳と卵を買う", { left: 600, top: 400, width: 420 })}
    </>
  ),
};

// 操作確認用 (近日): from から count 日分を mock から組み立てて days に渡す (Rust の upcoming_view の代わり)。
// 「さらに 7 日」で count を増やし、月セレクトで from を変える (切り替えると 7 日に戻す)。完了・追加は mock 一覧に反映する。
function UpcomingInteractive() {
  const [list, setList] = useState<Task[]>(() => withoutNo(12, 13, 15));
  const [from, setFrom] = useState(TODAY);
  const [count, setCount] = useState(7);
  const days: DayGroup[] = Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    return {
      date,
      tasks: list.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.due === date).sort((a, b) => a.no - b.no),
    };
  });
  return (
    <DragProvider
      onDrop={(r) => {
        if (r.kind === "day") setList((cur) => cur.map((x) => (x.no === r.source.task.no ? { ...x, due: r.date } : x)));
      }}
    >
      {navShell(
    { kind: "upcoming" },
    <UpcomingView
      tasks={list}
      today={TODAY}
      days={days}
      onExtend={() => setCount((c) => Math.min(91, c + 7))}
      onJumpTo={(f) => {
        setFrom(f);
        setCount(7);
      }}
      onToggleDone={(t, done) => setList((cur) => cur.map((x) => (x.no === t.no ? { ...x, progress: done ? 100 : 0 } : x)))}
      onOpenTask={() => {}}
      onAddTask={(date, title) =>
        setList((cur) => [
          ...cur,
          {
            no: Math.max(0, ...cur.map((x) => x.no)) + 1,
            project: "受信トレイ",
            category: null,
            title,
            assignee: "たろう",
            priority: 4,
            progress: 0,
            due: date,
            labels: [],
            reminders: [],
            order: 0,
            createdAt: `${TODAY}T09:00`,
          },
        ])
      }
    />,
      )}
    </DragProvider>
  );
}

export const D05Interactive: Story = {
  name: "D-05 近日 (操作)",
  render: () => <UpcomingInteractive />,
};

export const D06: Story = {
  name: "D-06 フィルターとラベル",
  render: () => navShell({ kind: "labels" }, <LabelsView labels={labels} filters={filters} counts={labelCounts} />),
};

export const D06b: Story = {
  name: "D-06b ラベル詳細",
  render: () => navShell({ kind: "labels" }, <LabelDetailView label="食品" tasks={tasks} />),
};

export const D07: Story = {
  name: "D-07 日付ピッカー",
  render: () => <DetailScreen initialPopover="date" />,
};

export const D07b: Story = {
  name: "D-07b 繰り返し設定",
  render: () => <DetailScreen initialPopover="recurrence" />,
};

export const D08: Story = {
  name: "D-08 リマインダー",
  render: () => <DetailScreen initialPopover="reminder" />,
};

export const D08b: Story = {
  name: "D-08b OS 通知",
  parameters: { layout: "fullscreen" },
  render: () => <OsNotification title="牛乳と卵を買う" sub="15:00 · 買い物" />,
};

// D-09 系: D-01 の上に設定ダイアログ。同期先セグメントで本文が切り替わり、ログイン / 接続 / ログアウト / 切断で接続状態が動く。
// scrim クリック / Esc で閉じ、サイドバーのアカウントで開き直す。サイドバー最下部の同期状態は pen に合わせて Story ごとに渡す。
function SettingsScreen({ initialTarget, connected, syncState, lastSyncedAt }: { initialTarget: SyncTarget; connected?: boolean; syncState: SyncState; lastSyncedAt?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <AppShell
      sidebar={
        <Sidebar
          active={{ kind: "project", name: "買い物" }}
          counts={counts}
          projects={projects}
          syncState={syncState}
          lastSyncedAt={lastSyncedAt}
          onOpenSettings={() => setOpen(true)}
        />
      }
      syncState={syncState}
      overlay={<SettingsDialog open={open} initialTarget={initialTarget} connected={connected} onClose={() => setOpen(false)} />}
    >
      <ProjectView project="買い物" tasks={shopping} sections={sections} />
    </AppShell>
  );
}

export const D09: Story = {
  name: "D-09 設定",
  render: () => <SettingsScreen initialTarget="google" syncState="off" />,
};

function ConflictScreen() {
  const [shown, setShown] = useState(true);
  return (
    <AppShell
      sidebar={<Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="error" />}
      syncState="error"
      banner={shown ? <ConflictBanner fileName="買い物.xlsx" conflictName="買い物 (競合 2026-10-13 0941).xlsx" onClose={() => setShown(false)} /> : undefined}
    >
      <ProjectView project="買い物" tasks={shopping} sections={sections} />
    </AppShell>
  );
}

export const D09b: Story = {
  name: "D-09b 競合バナー",
  render: () => <ConflictScreen />,
};

export const D09c: Story = {
  name: "D-09c 設定 (接続済み)",
  render: () => <SettingsScreen initialTarget="google" connected syncState="synced" lastSyncedAt="09:41" />,
};

export const D09d: Story = {
  name: "D-09d 同期状態一覧",
  render: () => <SyncSamples />,
};

export const D09e: Story = {
  name: "D-09e 設定 (NAS 未接続)",
  render: () => <SettingsScreen initialTarget="nas" syncState="off" />,
};

export const D09f: Story = {
  name: "D-09f 設定 (NAS 接続済み)",
  render: () => <SettingsScreen initialTarget="nas" connected syncState="synced" lastSyncedAt="09:41" />,
};

export const D10: Story = {
  name: "D-10 ボード",
  render: () => (
    <AppShell sidebar={sidebar} syncState="synced" fullWidth>
      <BoardView project="買い物" tasks={shopping} sections={sections} dragging={1} />
    </AppShell>
  ),
};

export const D11a: Story = {
  name: "D-11a 空のプロジェクト",
  render: () => <Screen state="empty" />,
};

export const D11b: Story = {
  name: "D-11b 読み込みエラー",
  render: () => <Screen state="error" />,
};

export const D11c: Story = {
  name: "D-11c 要修正行",
  render: () => (
    <AppShell sidebar={sidebar} syncState="synced" banner={<FixBanner />}>
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} state="invalid" />
    </AppShell>
  ),
};

export const D12: Story = {
  name: "D-12 初回起動",
  render: () => <Onboarding step={1} />,
};

export const D12b: Story = {
  name: "D-12b 初回起動 (Google 接続)",
  render: () => <Onboarding step={2} target="google" />,
};

export const D12c: Story = {
  name: "D-12c 初回起動 (受信トレイ)",
  render: () => <Onboarding step={3} />,
};

export const D12d: Story = {
  name: "D-12d 初回起動 (NAS)",
  render: () => <Onboarding step={2} target="nas" />,
};

// 狭いウィンドウ (750 未満): 左の一覧は隠れ、上の帯の左のボタンで、暗い背景の上に重ねて出す (Todoist)。
const openButton = <Button variant="icon" icon={PanelLeftOpen} ariaLabel="サイドバーを開く" />;
const drawer = (
  <div style={{ width: "100%", height: "100%", display: "flex", background: "var(--color-scrim)", pointerEvents: "auto" }}>
    <div style={{ flex: "0 0 280px", width: 280, height: "100%", background: "var(--color-bg-sidebar)" }}>{sidebar}</div>
  </div>
);

export const D13a: Story = {
  name: "D-13a 狭いウィンドウ 700 (一覧を開く)",
  render: () => (
    <AppShell width={960} widthPx={700} sidebar={sidebar} topBarLeft={openButton} overlay={drawer}>
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} />
    </AppShell>
  ),
};

export const D13b: Story = {
  name: "D-13b 狭いウィンドウ 400",
  render: () => (
    <AppShell width={960} widthPx={400} sidebar={sidebar} topBarLeft={openButton}>
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} />
    </AppShell>
  ),
};

export const D14: Story = {
  name: "D-14 完了のお知らせ",
  render: () => (
    <AppShell
      sidebar={<Sidebar active={{ kind: "today" }} counts={counts} projects={projects} syncState="synced" lastSyncedAt="09:41" />}
      overlay={<Toast text="2 件のタスクを完了しました" onAction={() => {}} onClose={() => {}} />}
    >
      <TodayView tasks={withoutNo(15)} today={TODAY} />
    </AppShell>
  ),
};
