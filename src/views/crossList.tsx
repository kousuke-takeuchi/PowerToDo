import { useEffect, useRef, useState } from "react";
import { AddTaskRow } from "../components/AddTaskRow";
import type { Task } from "../types/model";
import { SubtaskForm } from "./SubtaskForm";

/** 完了にしたチェックが付いたまま行を残す時間 (ms)。ProjectView と同じ。 */
export const LEAVE_DELAY_MS = 400;

/** 横断ビューの行のキー。番号はプロジェクトごとなので project と組にする。 */
export const taskKey = (t: Task) => `${t.project}/${t.no}`;

type Entry = { task: Task; group: string; index: number };

/**
 * 横断ビュー (今日 / 近日 / ラベル) の「完了にした直後の行」。完了にしたタスクは Rust のビューからすぐ消えるので、
 * LEAVE_DELAY_MS のあいだだけ元の位置 (グループ内の index) に完了表示のまま残してから退場させる。
 */
export function useLeaving() {
  const [entries, setEntries] = useState<Map<string, Entry>>(() => new Map());
  const timers = useRef(new Map<string, number>());
  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
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
  const clearTimer = (k: string) => {
    const id = timers.current.get(k);
    if (id !== undefined) {
      window.clearTimeout(id);
      timers.current.delete(k);
    }
  };

  const begin = (t: Task, group: string, index: number) => {
    const k = taskKey(t);
    clearTimer(k);
    setEntries((m) => new Map(m).set(k, { task: { ...t, progress: 100 }, group, index }));
    timers.current.set(
      k,
      window.setTimeout(() => {
        timers.current.delete(k);
        drop(k);
      }, LEAVE_DELAY_MS),
    );
  };
  const cancel = (t: Task) => {
    const k = taskKey(t);
    clearTimer(k);
    drop(k);
  };
  const isLeaving = (t: Task) => entries.has(taskKey(t));

  /** `list` (そのグループの現在の行) に、すでにビューから消えた退場中の行を元の位置へ戻して返す。 */
  const merge = (group: string, list: Task[]): Task[] => {
    const present = new Set(list.map(taskKey));
    const back = [...entries.entries()].filter(([k, e]) => e.group === group && !present.has(k)).sort((a, b) => a[1].index - b[1].index);
    if (back.length === 0) return list;
    const out = list.slice();
    for (const [, e] of back) out.splice(Math.min(e.index, out.length), 0, e.task);
    return out;
  };

  return { begin, cancel, isLeaving, merge };
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
