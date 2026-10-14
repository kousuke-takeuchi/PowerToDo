import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import { onProjectChanged, onProjectsChanged, onSaveStatus } from "../api/events";
import type { Task, TaskInput } from "../types/model";

/**
 * One cross-project view (今日 / 近日 / ラベル詳細). `fetch` is re-run when `deps` change, when any project changes
 * (`project-changed`, `projects-changed`, a finished save), and on `refresh()`. Overlapping requests are coalesced:
 * while one is in flight, further triggers mark it stale and one more fetch runs after it. Late responses are dropped.
 */
export function useCrossView<T>(fetch: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const inFlight = useRef(false);
  const stale = useRef(false);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const run = useCallback(async () => {
    if (inFlight.current) {
      stale.current = true;
      return;
    }
    inFlight.current = true;
    const g = gen.current;
    try {
      const v = await fetchRef.current();
      if (g === gen.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      if (stale.current) {
        stale.current = false;
        void run();
      }
    }
  }, []);

  useEffect(() => {
    gen.current += 1;
    setData(null);
    setError(null);
    void run();
    return () => {
      gen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => onProjectChanged(() => void run()), [run]);
  useEffect(() => onProjectsChanged(() => void run()), [run]);
  useEffect(() => onSaveStatus((s) => s.state === "saved" && void run()), [run]);

  return { data, error, refresh: run };
}

/** Task operations from a cross-project list: each calls the Phase 1 command for `t.project`, then refreshes. */
export function useCrossActions(refresh: () => void, onError: (e: unknown) => void, inbox: string) {
  const wrap = useCallback(
    async (call: () => Promise<unknown>) => {
      try {
        await call();
      } catch (e) {
        onError(e);
      } finally {
        refresh();
      }
    },
    [refresh, onError],
  );
  return {
    toggleDone: (t: Task, done: boolean) => wrap(() => api.completeTask(t.project, t.no, done)),
    setPriority: (t: Task, priority: 1 | 2 | 3 | 4) => wrap(() => api.updateTask(t.project, t.no, { priority })),
    setDue: (t: Task, due: string | null) => wrap(() => api.updateTask(t.project, t.no, { due, dueTime: due ? undefined : null })),
    remove: (t: Task) => wrap(() => api.deleteTask(t.project, t.no)),
    addToInbox: (input: TaskInput) => wrap(() => api.addTask(inbox, input)),
  };
}
