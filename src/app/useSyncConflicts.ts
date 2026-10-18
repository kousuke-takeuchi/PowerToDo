import { useCallback, useEffect, useState } from "react";
import { onSyncConflict } from "../api/events";
import type { SyncConflict } from "../types/model";

/**
 * まだ閉じていない競合の通知 (`sync-conflict`)。`App` で一度だけ購読する: 初回起動の step 2 (同期先) で起きた
 * 初回同期の競合も、メイン画面の帯に届くように、画面の切り替え (初回起動 → メイン) より上で持つ。
 * 同じ競合コピーの通知は一つにまとめる (StrictMode で購読がつなぎ直される間に重なって届いても)。
 */
export function useSyncConflicts() {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  useEffect(
    () => onSyncConflict((c) => setConflicts((cur) => (cur.some((x) => x.conflictFile === c.conflictFile) ? cur : [...cur, c]))),
    [],
  );
  const dismissConflict = useCallback((conflictFile: string) => setConflicts((cur) => cur.filter((c) => c.conflictFile !== conflictFile)), []);
  return { conflicts, dismissConflict };
}

export type SyncConflicts = ReturnType<typeof useSyncConflicts>;
