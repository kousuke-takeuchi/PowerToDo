import type { Task } from "../types/model";
import type { ExpandApi } from "../views/ProjectView";
import { taskKey } from "../views/crossList";
import type { SidebarProps } from "../views/Sidebar";
import { addDays } from "./dates";
import type { RowHandlers } from "./shortcuts";
import { useShortcuts } from "./shortcuts";
import type { useCrossActions } from "./useCrossView";
import type { useProject } from "./useProject";
import type { useRowFocus } from "./useRowFocus";

type Nav = SidebarProps["active"];

/** キーボード操作 (shortcuts.ts) とフォーカス行のタスクへの操作。 */
export function useRowShortcuts({
  focus,
  visibleKeys,
  focusedTaskPool,
  p,
  cross,
  current,
  projectScreen,
  today,
  openCross,
  expandApi,
  enabled,
  navigate,
  openQuickAdd,
  openSearch,
  onCompleted,
  requestDelete,
  edit,
}: {
  focus: ReturnType<typeof useRowFocus>;
  visibleKeys: string[];
  /** いま出ているビューのタスク (フォーカス行を探す範囲)。フォーカスがあるときだけ呼ぶ。 */
  focusedTaskPool: () => Task[];
  p: ReturnType<typeof useProject>;
  cross: ReturnType<typeof useCrossActions>;
  current: string;
  projectScreen: boolean;
  today: string;
  openCross: (t: Task) => void;
  expandApi: { current: ExpandApi | null };
  enabled: boolean;
  navigate: (target: Nav) => void;
  openQuickAdd: () => void;
  openSearch: () => void;
  /** A task was completed with `e` (for the undo toast). */
  onCompleted?: (t: Task) => void;
  /** Delete / Backspace / ⌘⌫: show the delete confirmation (spec ② §4.3). */
  requestDelete: (t: Task) => void;
  /** ⌘E: edit the row in place (spec ② §7). */
  edit: (key: string) => void;
}) {
  // ---- キーボード操作 (shortcuts.ts)。フォーカス行のタスクは、いま出ているビューのデータから探す ----
  const focusedTask = (() => {
    const k = focus.focusedKey;
    if (k === null) return undefined;
    return focusedTaskPool().find((t) => taskKey(t) === k);
  })();
  /** そのプロジェクトの画面に出ている行か (useProject 経由で更新する) 。今日 / 近日 / ラベルの行は cross 経由。 */
  const onProjectScreen = (t: Task) => projectScreen && t.project === current;
  const actOn = {
    toggleDone: (t: Task) => {
      const done = t.progress !== 100;
      void (onProjectScreen(t) ? p.completeTask(t.no, done) : cross.toggleDone(t, done)).then((ok) => {
        if (ok && done) onCompleted?.(t);
      });
    },
    setPriority: (t: Task, priority: 1 | 2 | 3 | 4) =>
      onProjectScreen(t) ? void p.updateTask(t.no, { priority }) : void cross.setPriority(t, priority),
    // dueTime は触らない (時刻は保つ)
    setDue: (t: Task, due: string) => (onProjectScreen(t) ? void p.updateTask(t.no, { due }) : void cross.setDue(t, due)),
  };
  const deleteAny = (t: Task) => requestDelete(t);
  /** Opens the task dialog over the current view (spec ① §2.5), from any view. */
  const openAny = (t: Task) => openCross(t);
  const row: RowHandlers | null = visibleKeys.length
    ? {
        hasFocus: !!focusedTask,
        up: () => focus.move(-1),
        down: () => focus.move(1),
        open: () => focusedTask && openAny(focusedTask),
        toggleDone: () => focusedTask && actOn.toggleDone(focusedTask),
        remove: () => focusedTask && deleteAny(focusedTask),
        edit: () => focusedTask && edit(taskKey(focusedTask)),
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
    search: openSearch,
    goToday: () => navigate({ kind: "today" }),
    goUpcoming: () => navigate({ kind: "upcoming" }),
    goInbox: () => navigate({ kind: "inbox" }),
    goLabels: () => navigate({ kind: "labels" }),
    row,
    enabled,
  });
  return { focusedTask, openAny, deleteAny };
}
