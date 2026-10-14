import { useCallback, useEffect, useRef, useState } from "react";

/** Keyboard focus over a list of row keys (display order). When the focused row disappears, focus moves to the row now at its index. */
export function useRowFocus(keys: string[]) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const lastIndex = useRef(-1);

  useEffect(() => {
    if (focusedKey === null) return;
    const i = keys.indexOf(focusedKey);
    if (i >= 0) {
      lastIndex.current = i;
      return;
    }
    if (keys.length === 0) {
      setFocusedKey(null);
      return;
    }
    setFocusedKey(keys[Math.min(lastIndex.current, keys.length - 1)]);
  }, [keys, focusedKey]);

  const move = useCallback(
    (delta: -1 | 1) => {
      if (keys.length === 0) return;
      const i =
        focusedKey === null
          ? delta === 1
            ? 0
            : keys.length - 1
          : Math.max(0, Math.min(keys.length - 1, keys.indexOf(focusedKey) + delta));
      setFocusedKey(keys[i]);
    },
    [keys, focusedKey],
  );

  const clear = useCallback(() => setFocusedKey(null), []);
  return { focusedKey, move, clear, set: setFocusedKey };
}

/**
 * Tells the parent the row keys on screen (display order) when they change, and `[]` when the view goes away.
 * `getKeys` is read after every commit (so a list built while rendering is complete by then); `report` is called only
 * when the joined keys differ from the last report, so the parent's state update cannot loop.
 */
export function useReportKeys(getKeys: () => string[], report?: (keys: string[]) => void): void {
  const reportRef = useRef(report);
  reportRef.current = report;
  const last = useRef<string | null>(null);
  useEffect(() => {
    const keys = getKeys();
    const joined = keys.join("\n");
    if (joined === last.current) return;
    last.current = joined;
    reportRef.current?.(keys);
  });
  useEffect(
    () => () => {
      last.current = null;
      reportRef.current?.([]);
    },
    [],
  );
}
