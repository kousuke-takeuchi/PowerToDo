import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { AnimatePresence } from "motion/react";
import { AddTaskRow } from "../components/AddTaskRow";
import { TaskRow } from "../components/TaskRow";
import type { TaskRowProps } from "../components/TaskRow";
import { Collapse } from "../motion";
import type { Task } from "../types/model";
import { useReportKeys } from "../app/useRowFocus";
import { SubtaskForm } from "./SubtaskForm";
import { useDone } from "./useDone";

/** 完了にしたチェックが付いたまま行を残す時間 (ms)。ProjectView と同じ。 */
export const LEAVE_DELAY_MS = 400;

/** 横断ビューの行のキー。番号はプロジェクトごとなので project と組にする。 */
export const taskKey = (t: Task) => `${t.project}/${t.no}`;

/** 完了にしたのにビューから消えない (保存の失敗など) 行を、完了表示のまま残し続けない上限 (ms)。 */
const LEAVE_MAX_MS = 3000;

type Entry = { task: Task; group: string; index: number; elapsed: boolean };

/**
 * 横断ビュー (今日 / 近日 / ラベル) の「完了にした直後の行」。完了にしたタスクは Rust のビューからすぐ消えるので、
 * LEAVE_DELAY_MS のあいだだけ元の位置 (グループ内の index) に完了表示のまま残してから退場させる。
 * 完了の保存と再取得が LEAVE_DELAY_MS より長くかかるときは、`tasks` (いま届いているビューの全行) から消えるまで
 * 完了表示のまま待つ (チェックが一瞬戻らない)。待つのは最長 LEAVE_MAX_MS。
 */
export function useLeaving(tasks: Task[]) {
  const [entries, setEntries] = useState<Map<string, Entry>>(() => new Map());
  const timers = useRef(new Map<string, number[]>());
  useEffect(
    () => () => {
      timers.current.forEach((ids) => ids.forEach((id) => window.clearTimeout(id)));
      timers.current.clear();
    },
    [],
  );

  const drop = (k: string) =>
    setEntries((m) => {
      if (!m.has(k)) return m;
      const n = new Map(m);
      n.delete(k);
      return n;
    });
  const clearTimers = (k: string) => {
    timers.current.get(k)?.forEach((id) => window.clearTimeout(id));
    timers.current.delete(k);
  };

  const begin = (t: Task, group: string, index: number) => {
    const k = taskKey(t);
    clearTimers(k);
    setEntries((m) => new Map(m).set(k, { task: { ...t, progress: 100 }, group, index, elapsed: false }));
    const elapse = window.setTimeout(
      () =>
        setEntries((m) => {
          const e = m.get(k);
          return e && !e.elapsed ? new Map(m).set(k, { ...e, elapsed: true }) : m;
        }),
      LEAVE_DELAY_MS,
    );
    const giveUp = window.setTimeout(() => {
      timers.current.delete(k);
      drop(k);
    }, LEAVE_MAX_MS);
    timers.current.set(k, [elapse, giveUp]);
  };
  const cancel = (t: Task) => {
    const k = taskKey(t);
    clearTimers(k);
    drop(k);
  };
  const isLeaving = (t: Task) => entries.has(taskKey(t));

  // 時間が過ぎた行は、まだ未完了としてビューに残っている間だけ保持する。消えたら (または完了で届いたら) 手放す。
  const openKeys = new Set(tasks.filter((t) => t.progress < 100).map(taskKey));
  useEffect(() => {
    const done = [...entries].filter(([k, e]) => e.elapsed && !openKeys.has(k)).map(([k]) => k);
    if (done.length === 0) return;
    done.forEach(clearTimers);
    setEntries((m) => {
      const n = new Map(m);
      done.forEach((k) => n.delete(k));
      return n;
    });
  });

  /** `list` (そのグループの現在の行) に、すでにビューから消えた退場中の行を元の位置へ戻して返す。 */
  const merge = (group: string, list: Task[]): Task[] => {
    const present = new Set(list.map(taskKey));
    const back = [...entries.entries()]
      .filter(([k, e]) => e.group === group && !e.elapsed && !present.has(k))
      .sort((a, b) => a[1].index - b[1].index);
    if (back.length === 0) return list;
    const out = list.slice();
    for (const [, e] of back) out.splice(Math.min(e.index, out.length), 0, e.task);
    return out;
  };

  return { begin, cancel, isLeaving, merge };
}

export type CrossRowsOptions = {
  /** いまビューに届いている全行 (退場中の行を手放す判断に使う)。 */
  tasks: Task[];
  /** 渡すと実アプリの挙動 (完了は task.progress から決まり、完了直後の行は残してから畳む)。無ければ見た目だけのトグル。 */
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 行の期限ラベル。無ければ出さない。 */
  date?: (t: Task) => TaskRowProps["date"];
  /** キーボードのフォーカス行 (taskKey)。その行の TaskRow に `focused` を渡す。 */
  focusedKey?: string;
  /** 描画した行のキーを表示順に親へ知らせる (変わったときだけ呼ぶ。ビューが消えるときは [])。 */
  onVisibleKeys?: (keys: string[]) => void;
};

/**
 * 今日 / 近日 / ラベル詳細の行 (チェック・退場・開く) を作る。戻り値の `rows(group, list)` が、グループ `group` の
 * `list` を描画する要素にする。`onToggleDone` が無いときは従来どおりの素の TaskRow の並び (ラッパーなし)。
 */
export function useCrossRows({ tasks, onToggleDone, onOpenTask, date, focusedKey, onVisibleKeys }: CrossRowsOptions) {
  const { isDone: fakeDone, toggle: fakeToggle } = useDone();
  const leave = useLeaving(tasks);
  // `rows()` を呼んだ順 (= 表示順) に積む。描画ごとに作り直し、コミット後に useReportKeys が読む。
  const shown: string[] = [];
  useReportKeys(() => shown, onVisibleKeys);

  const isDone = (t: Task) => (onToggleDone ? t.progress === 100 || leave.isLeaving(t) : fakeDone(t));
  const toggle = (t: Task, group: string, index: number) => {
    if (!onToggleDone) {
      fakeToggle(t);
      return;
    }
    const next = !isDone(t);
    if (next) leave.begin(t, group, index);
    else leave.cancel(t);
    onToggleDone(t, next);
  };
  const row = (group: string) => (t: Task, index: number) => {
    shown.push(taskKey(t));
    const el = (
      <TaskRow
        key={onToggleDone ? taskKey(t) : t.no}
        title={t.title}
        done={isDone(t)}
        priority={t.priority}
        date={date?.(t)}
        project={t.project}
        focused={focusedKey === taskKey(t)}
        onClick={onOpenTask ? () => onOpenTask(t) : undefined}
        onToggleDone={() => toggle(t, group, index)}
      />
    );
    return onToggleDone ? (
      <Collapse key={taskKey(t)} enterY={-8} exitX={-24}>
        {el}
      </Collapse>
    ) : (
      el
    );
  };
  return (group: string, list: Task[]) => {
    const items = (onToggleDone ? leave.merge(group, list) : list).map(row(group));
    return onToggleDone ? <AnimatePresence initial={false}>{items}</AnimatePresence> : items;
  };
}

/** `open` の間、`ref` の外での mousedown で `close` を呼ぶ (HeaderActions の MoreMenu と同じ判定)。 */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) closeRef.current();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, ref]);
}

/**
 * 「タスクを追加」行。`onAdd` があるとクリックでインライン入力 (SubtaskForm、ProjectView と同じ) に変わり、
 * 確定でタイトルを渡す。無いときは見た目だけの行。
 */
export function AddSlot({ label, onAdd }: { label?: string; onAdd?: (title: string) => void }) {
  const [adding, setAdding] = useState(false);
  if (onAdd && adding) {
    return (
      <SubtaskForm
        autoFocus
        compact
        placeholder="タスク名"
        submitLabel="タスクを追加"
        onCancel={() => setAdding(false)}
        onSubmit={(title) => {
          setAdding(false);
          onAdd(title.trim());
        }}
      />
    );
  }
  return <AddTaskRow label={label} onClick={onAdd ? () => setAdding(true) : undefined} />;
}

/** 読み込めなかったプロジェクトがあるとき、横断ビューの上に出す 1 行の注記 (仕様 §7)。 */
export function HiddenNote({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return null;
  return (
    <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "4px 0" }}>
      「{names.join("」「")}」は読み込めていません (サイドバーから開いて確認)
    </div>
  );
}
