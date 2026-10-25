import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { onProjectsChanged } from "../../api/events";
import { DEFAULTS, formatView, mergePending, parseView, sanitize, viewKey, type Screen, type ViewOptions } from "./viewOptions";

export type ViewOptionsApi = { get: (key: string) => ViewOptions; set: (key: string, o: ViewOptions) => void };
export const ViewOptionsCtx = createContext<ViewOptionsApi | null>(null);

/** Main's handle: also reloads after a rename / delete moved or removed a row, and drops a pending write for the old key. */
export type ViewOptionsStore = ViewOptionsApi & { reload: () => void; forget: (key: string) => void };

const SAVE_DELAY_MS = 500;

/** Main: the 表示 rows of the common book, saved 0.5 s after the last change (spec ⑤ §6). */
export function useViewOptionsStore(): ViewOptionsStore {
  const [rows, setRows] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, number>());
  // Values not yet saved (key → value, "" = remove), kept until their write settles; a reload is merged under them.
  const pending = useRef(new Map<string, { value: string; seq: number }>());
  // Bumped on every change and every load: a load that a later change or load overtook is stale and dropped.
  const seq = useRef(0);
  const reload = useCallback(() => {
    const at = ++seq.current;
    void api.viewOptions().then(
      (loaded) => {
        if (at !== seq.current) return;
        setRows(mergePending(loaded, new Map([...pending.current].map(([k, p]) => [k, p.value]))));
      },
      () => undefined,
    );
  }, []);
  useEffect(() => {
    reload();
    return onProjectsChanged(reload);
  }, [reload]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const get = useCallback((key: string) => parseView(rows[key]), [rows]);
  const set = useCallback((key: string, o: ViewOptions) => {
    const value = formatView(o);
    const mine = ++seq.current;
    pending.current.set(key, { value, seq: mine });
    setRows((r) => mergePending(r, new Map([[key, value]])));
    window.clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        const settle = () => {
          if (pending.current.get(key)?.seq === mine) pending.current.delete(key);
        };
        void api.setViewOption(key, value).then(settle, settle);
      }, SAVE_DELAY_MS),
    );
  }, []);
  const forget = useCallback((key: string) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    pending.current.delete(key);
  }, []);
  return { get, set, reload, forget };
}

/** A screen's options (sanitized for that screen); without a provider, local state for stories. */
export function useView(screen: Screen, name?: string, initial: ViewOptions = DEFAULTS): [ViewOptions, (o: ViewOptions) => void] {
  const ctx = useContext(ViewOptionsCtx);
  const [local, setLocal] = useState(initial);
  const key = viewKey(screen, name);
  const value = sanitize(screen, ctx ? ctx.get(key) : local);
  const set = useCallback((o: ViewOptions) => (ctx ? ctx.set(key, sanitize(screen, o)) : setLocal(o)), [ctx, key, screen]);
  return [value, set];
}
