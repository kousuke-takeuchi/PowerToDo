import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { onReminderFired } from "../api/events";
import type { ReminderItem } from "../types/model";

const keyOf = (r: Pick<ReminderItem, "project" | "no" | "code">) => `${r.project}/${r.no}/${r.code}`;

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
 * `complete` は横断ビューの完了処理 (警告の表示・refreshAll つき。成功で true)、`openTask` は
 * そのプロジェクトを開いて詳細パネルを出す処理。
 */
export function useReminders({
  onError,
  complete,
  openTask,
}: {
  onError: (e: unknown) => void;
  complete: (project: string, no: number) => Promise<boolean>;
  openTask: (project: string, no: number) => void;
}) {
  const [items, setItems] = useState<ReminderItem[]>([]);
  // 「明日」の時刻 (設定の通知時刻)。取れなければ 09:00。
  const [notifyTime, setNotifyTime] = useState("09:00");
  const live = useRef({ onError, complete, openTask });
  live.current = { onError, complete, openTask };

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
    return onReminderFired(() => void fetchPending());
  }, [fetchPending]);

  const remove = useCallback((item: ReminderItem) => setItems((prev) => prev.filter((r) => keyOf(r) !== keyOf(item))), []);

  return {
    items,
    notifyTime,
    fetchPending,
    /** 完了にして帯から消す。失敗したら (エラーを出して) 残す。 */
    done: async (item: ReminderItem) => {
      if (await live.current.complete(item.project, item.no)) remove(item);
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
    dismissAll: useCallback(() => setItems([]), []),
  };
}
