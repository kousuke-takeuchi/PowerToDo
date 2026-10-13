import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import { onProjectChanged } from "../api/events";
import type { ProjectView, QuickAddOutcome, QuickAddResult, TaskInput, TaskPatch } from "../types/model";

export type UseProjectOptions = {
  /** Called after every successful command (the sidebar refreshes its counts here). */
  onMutated?: () => void;
};

/**
 * State of one project. Every command's returned `ProjectView` replaces `view`.
 *
 * - `error`: the project could not be loaded (D-11b). Cleared by the next successful load / command.
 * - `notice`: the last command failed (shown as an inline message). The view is left as it was.
 *
 * All calls run one after another (a queue), so a response never overtakes an earlier one, and a response that
 * arrives after the project changed (or the component unmounted) is dropped.
 */
export function useProject(name: string, opts: UseProjectOptions = {}) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const gen = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const onMutated = useRef(opts.onMutated);
  onMutated.current = opts.onMutated;

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(job);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  /** Load (get_project, or reload_project to re-read the file). `silent` keeps the current view on screen meanwhile. */
  const load = useCallback(
    (call: () => Promise<ProjectView>, silent: boolean) => {
      const g = gen.current;
      return enqueue(async () => {
        if (g !== gen.current) return;
        if (!silent) setLoading(true);
        try {
          const v = await call();
          if (g !== gen.current) return;
          setView(v);
          setError(null);
        } catch (e) {
          if (g === gen.current) setError(errorMessage(e));
        } finally {
          if (g === gen.current) setLoading(false);
          onMutated.current?.();
        }
      });
    },
    [enqueue],
  );

  useEffect(() => {
    gen.current += 1;
    setView(null);
    setError(null);
    setNotice(null);
    setLoading(true);
    void load(() => api.getProject(name), false);
    return () => {
      gen.current += 1;
    };
  }, [name, load]);

  // `project-changed` (a change that did not come through this hook): re-read the in-memory state.
  useEffect(() => onProjectChanged((n) => n === name && void load(() => api.getProject(name), true)), [name, load]);

  /** Run a command that returns the new ProjectView. Resolves true on success; failure becomes `notice`. */
  const mutate = useCallback(
    (call: () => Promise<ProjectView>): Promise<boolean> => {
      const g = gen.current;
      return enqueue(async () => {
        try {
          const v = await call();
          if (g === gen.current) {
            setView(v);
            setError(null);
            setNotice(null);
          }
          onMutated.current?.();
          return true;
        } catch (e) {
          if (g === gen.current) setNotice(errorMessage(e));
          return false;
        }
      });
    },
    [enqueue],
  );

  const reload = useCallback(() => load(() => api.reloadProject(name), false), [load, name]);
  const addTask = useCallback((input: TaskInput) => mutate(() => api.addTask(name, input)), [mutate, name]);
  const updateTask = useCallback((no: number, patch: TaskPatch) => mutate(() => api.updateTask(name, no, patch)), [mutate, name]);
  const completeTask = useCallback((no: number, done: boolean) => mutate(() => api.completeTask(name, no, done)), [mutate, name]);
  const deleteTask = useCallback((no: number) => mutate(() => api.deleteTask(name, no)), [mutate, name]);
  const addSubtask = useCallback((parentNo: number, title: string) => addTask({ title, parentNo }), [addTask]);

  /**
   * quick_add into this project (a `#project` in the text may send it elsewhere). Rejects with the command's error so the
   * dialog can show it; `view` is replaced only when the task landed in this project.
   */
  const quickAdd = useCallback(
    (text: string): Promise<QuickAddOutcome> => {
      const g = gen.current;
      return enqueue(async () => {
        const out = await api.quickAdd(text, name);
        if (g === gen.current && out.view.project.name === name) {
          setView(out.view);
          setError(null);
        }
        onMutated.current?.();
        return out;
      });
    },
    [enqueue, name],
  );

  const parseQuickAdd = useCallback((text: string): Promise<QuickAddResult> => api.parseQuickAdd(text), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  return { view, loading, error, notice, clearNotice, reload, addTask, updateTask, completeTask, deleteTask, addSubtask, quickAdd, parseQuickAdd };
}
