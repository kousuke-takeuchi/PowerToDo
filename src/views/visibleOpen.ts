import type { Task } from "../types/model";

/** 見えている未完了の行: 未完了で、親をたどってすべて存在し未完了 (同じプロジェクトの中で)。Rust の `views::visible_open` と同じ規則。モック用。 */
export function visibleOpen(tasks: Task[]): Task[] {
  const byKey = new Map(tasks.map((t) => [`${t.project}/${t.no}`, t]));
  const ok = (t: Task): boolean => {
    let cur: Task | undefined = t;
    for (let i = 0; cur && i <= tasks.length; i++) {
      if (cur.progress >= 100) return false;
      if (cur.parentNo === undefined) return true;
      cur = byKey.get(`${cur.project}/${cur.parentNo}`);
    }
    return false;
  };
  return tasks.filter(ok);
}
