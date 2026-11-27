import { useCallback, useState } from "react";

/** A per-device on/off remembered in localStorage (a fold's open state). Storage may be blocked or empty: then it is just local state. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // not remembered
      }
    },
    [key],
  );
  return [value, set];
}
