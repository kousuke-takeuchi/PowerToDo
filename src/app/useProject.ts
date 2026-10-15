import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, isAppError } from "../api/client";
import { onProjectChanged, onProjectsChanged, onSaveStatus } from "../api/events";
import type { ProjectView, QuickAddOutcome, QuickAddResult, TaskInput, TaskPatch } from "../types/model";

export type UseProjectOptions = {
  /** Called after every successful command (the sidebar refreshes its counts here). */
  onMutated?: () => void;
  /** Called whenever a command's result carries `warnings` (e.g. an unreadable recurrence rule was ignored). */
  onWarnings?: (warnings: string[]) => void;
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
  const onWarnings = useRef(opts.onWarnings);
  onWarnings.current = opts.onWarnings;
  // project/no of completions in flight: a second toggle of the same task is ignored until the first answers
  // (a recurring task would otherwise advance twice).
  const completing = useRef(new Set<string>());

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(job);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  /**
   * Load (get_project, or reload_project to re-read the file). `silent` keeps the current view on screen meanwhile.
   * A failure becomes `error`, except one `rethrow` accepts: that one rejects the returned promise and changes nothing.
   */
  const load = useCallback(
    (call: () => Promise<ProjectView>, silent: boolean, rethrow?: (e: unknown) => boolean) => {
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
          if (rethrow?.(e)) throw e;
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

  // `projects-changed` (the project list changed as a whole; this project may be gone): re-read.
  useEffect(() => onProjectsChanged(() => void load(() => api.getProject(name), true)), [name, load]);

  // A save finished: the file's row numbers (invalid rows) may have changed with it, so re-read the in-memory view.
  useEffect(
    () => onSaveStatus((s) => s.project === name && s.state === "saved" && void load(() => api.getProject(name), true)),
    [name, load],
  );

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
          if (v.warnings?.length) onWarnings.current?.(v.warnings);
          return true;
        } catch (e) {
          if (g === gen.current) setNotice(errorMessage(e));
          return false;
        }
      });
    },
    [enqueue],
  );

  /**
   * reload_project. Without `discard`, a project with unsaved edits is left alone and the promise rejects with the
   * `unsaved` AppError (the caller asks the user, then calls again with `discard = true`). Other failures become `error`.
   */
  const reload = useCallback(
    (discard = false) =>
      load(() => api.reloadProject(name, discard), false, (e) => !discard && isAppError(e) && e.kind === "unsaved"),
    [load, name],
  );
  const addTask = useCallback((input: TaskInput) => mutate(() => api.addTask(name, input)), [mutate, name]);
  const updateTask = useCallback((no: number, patch: TaskPatch) => mutate(() => api.updateTask(name, no, patch)), [mutate, name]);
  const completeTask = useCallback(
    (no: number, done: boolean): Promise<boolean> => {
      const key = `${name}/${no}`;
      if (completing.current.has(key)) return Promise.resolve(false);
      completing.current.add(key);
      return mutate(() => api.completeTask(name, no, done)).finally(() => completing.current.delete(key));
    },
    [mutate, name],
  );
  const deleteTask = useCallback((no: number) => mutate(() => api.deleteTask(name, no)), [mutate, name]);
  const addSection = useCallback((section: string) => mutate(() => api.addSection(name, section)), [mutate, name]);
  const renameSection = useCallback((from: string, to: string) => mutate(() => api.renameSection(name, from, to)), [mutate, name]);
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
        if (out.view.warnings?.length) onWarnings.current?.(out.view.warnings);
        return out;
      });
    },
    [enqueue, name],
  );

  const parseQuickAdd = useCallback((text: string): Promise<QuickAddResult> => api.parseQuickAdd(text), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  return { view, loading, error, notice, clearNotice, reload, addTask, updateTask, completeTask, deleteTask, addSubtask, addSection, renameSection, quickAdd, parseQuickAdd };
}
