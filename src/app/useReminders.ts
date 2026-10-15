import { useCallback, useEffect, useRef, useState } from "react";
import { api, isAppError } from "../api/client";
import { onProjectChanged, onReminderFired } from "../api/events";
import type { ProjectView, ReminderItem } from "../types/model";

const keyOf = (r: Pick<ReminderItem, "project" | "no" | "code">) => `${r.project}/${r.no}/${r.code}`;

const same = (a: ReminderItem, b: ReminderItem) => keyOf(a) === keyOf(b) && a.at === b.at;

/** そのタスクが、もう通知した時点のタスクではない (消えた / 完了済み / 期限や時刻が変わった)。 */
function isStale(item: ReminderItem, view: ProjectView): boolean {
  const t = view.tasks.find((x) => x.no === item.no);
  return !t || t.progress === 100 || (t.due ?? null) !== (item.due ?? null) || (t.dueTime ?? null) !== (item.dueTime ?? null);
}

/** 帯の対象を 同じ project/no/コード は置き換えて足す (順序は初出のまま)。 */
function merge(list: ReminderItem[], incoming: ReminderItem[]): ReminderItem[] {
  const next = [...list];
  for (const item of incoming) {
    const i = next.findIndex((r) => keyOf(r) === keyOf(item));
    if (i >= 0) next[i] = item;
    else next.push(item);
  }
  return next;
}

/**
 * リマインダーの帯の状態 (仕様 §4.4)。起動時・`reminder-fired`・ウィンドウ再表示のたびに `pending_reminders` を呼び、
 * その戻り値を足す (イベントのペイロードは見ない。pending_reminders は溜まった分を渡して空にするので重複しない)。
 * 帯の内容はウィンドウを隠している間もここに溜まる。
 *
 * `complete` は完了処理 (開いているプロジェクトのタスクならその画面の処理、それ以外は横断ビューの処理。成功で true)、
 * `openTask` はそのプロジェクトを開いて詳細パネルを出す処理。
 */
export function useReminders({
  onError,
  onInfo,
  complete,
  openTask,
}: {
  onError: (e: unknown) => void;
  onInfo: (text: string) => void;
  complete: (project: string, no: number) => Promise<boolean>;
  openTask: (project: string, no: number) => void;
}) {
  const [items, setItems] = useState<ReminderItem[]>([]);
  // 「明日」の時刻 (設定の通知時刻)。取れなければ 09:00。
  const [notifyTime, setNotifyTime] = useState("09:00");
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const live = useRef({ onError, onInfo, complete, openTask });
  live.current = { onError, onInfo, complete, openTask };

  const fetchPending = useCallback(async () => {
    try {
      const { items: fresh } = await api.pendingReminders();
      if (fresh.length === 0) return;
      setItems((prev) => merge(prev, fresh));
      api
        .settings()
        .then((s) => s.notifyTime && setNotifyTime(s.notifyTime))
        .catch(() => undefined);
    } catch (e) {
      live.current.onError(e);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
    // 購読が張られるまで (listen は非同期) に発火した分のイベントは届かないので、張れた時点でもう一度取る
    return onReminderFired(
      () => void fetchPending(),
      () => void fetchPending(),
    );
  }, [fetchPending]);

  // 押した行だけを消す (同じタスクが再発火して置き換わった行は残す)
  const remove = useCallback((item: ReminderItem) => setItems((prev) => prev.filter((r) => !same(r, item))), []);
  /** そのタスクの行をすべて消す (通知のクリックで開いたとき)。 */
  const removeTask = useCallback((project: string, no: number) => setItems((prev) => prev.filter((r) => r.project !== project || r.no !== no)), []);

  // プロジェクトが変わったら、その行がまだ当てはまるか確かめて、当てはまらないものを消す
  useEffect(
    () =>
      onProjectChanged((name) => {
        if (!itemsRef.current.some((r) => r.project === name)) return;
        api
          .getProject(name)
          .then((view) => setItems((prev) => prev.filter((r) => r.project !== name || !isStale(r, view))))
          .catch(() => undefined);
      }),
    [],
  );

  /** 帯の行が古い (別の場所で処理済み) か。プロジェクトが無ければ古い。確かめられなければ古くないとして進める。 */
  const stale = async (item: ReminderItem): Promise<boolean> => {
    try {
      return isStale(item, await api.getProject(item.project));
    } catch (e) {
      return isAppError(e) && e.kind === "not_found";
    }
  };

  return {
    items,
    notifyTime,
    fetchPending,
    /** 完了にして帯から消す。失敗したら (エラーを出して) 残す。 */
    done: async (item: ReminderItem) => {
      // 通知のボタンやタスク一覧で先に処理されていたら、完了にしない (繰り返しの次回を飛ばさない)
      if (await stale(item)) {
        remove(item);
        live.current.onInfo("このリマインダーは既に処理されています");
        return;
      }
      // 完了したタスクの行はすべて消す (同じタスクの別のリマインダーの行も)
      if (await live.current.complete(item.project, item.no)) removeTask(item.project, item.no);
    },
    /** `until` (ローカルの YYYY-MM-DDTHH:MM) に再通知するよう頼み、帯から消す。 */
    snooze: async (item: ReminderItem, until: string) => {
      try {
        await api.snoozeReminder(item.project, item.no, item.code, until);
        remove(item);
      } catch (e) {
        live.current.onError(e);
      }
    },
    /** 帯から消して、そのタスクの詳細を開く。 */
    open: (item: ReminderItem) => {
      remove(item);
      live.current.openTask(item.project, item.no);
    },
    /** 帯から消すだけ (発火済みの記録はそのまま)。 */
    dismiss: remove,
    removeTask,
    /** 帯を空にする (すべて閉じる / データフォルダが変わったとき)。 */
    clear: useCallback(() => setItems([]), []),
  };
}
