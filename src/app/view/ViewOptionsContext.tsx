import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { onProjectsChanged } from "../../api/events";
import { DEFAULTS, formatView, parseView, sanitize, viewKey, type Screen, type ViewOptions } from "./viewOptions";

export type ViewOptionsApi = { get: (key: string) => ViewOptions; set: (key: string, o: ViewOptions) => void };
export const ViewOptionsCtx = createContext<ViewOptionsApi | null>(null);

const SAVE_DELAY_MS = 500;

/** Main: the 表示 rows of the common book, saved 0.5 s after the last change (spec ⑤ §6). */
export function useViewOptionsStore(): ViewOptionsApi {
  const [rows, setRows] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, number>());
  const load = useCallback(() => void api.viewOptions().then(setRows, () => undefined), []);
  useEffect(() => {
    load();
    return onProjectsChanged(load);
  }, [load]);
  useEffect(() => () => pending.current.forEach((id) => window.clearTimeout(id)), []);
  const get = useCallback((key: string) => parseView(rows[key]), [rows]);
  const set = useCallback((key: string, o: ViewOptions) => {
    const value = formatView(o);
    setRows((r) => {
      const next = { ...r };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    window.clearTimeout(pending.current.get(key));
    pending.current.set(
      key,
      window.setTimeout(() => {
        pending.current.delete(key);
        void api.setViewOption(key, value).catch(() => undefined);
      }, SAVE_DELAY_MS),
    );
  }, []);
  return { get, set };
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
