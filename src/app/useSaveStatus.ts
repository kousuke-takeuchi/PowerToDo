import { useCallback, useEffect, useState } from "react";
import { onSaveStatus } from "../api/events";

/**
 * Projects whose last save failed, as { project -> message }. `save-status: error` adds an entry, `saved` removes it;
 * `saving` (a retry in progress) leaves it as is. `project` is a project name or "_common".
 * `clear()` drops every entry (the data folder changed, so the old folder's failures no longer apply).
 */
export function useSaveErrors(): { errors: Record<string, string>; clear: () => void } {
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(
    () =>
      onSaveStatus((s) => {
        if (s.state === "error") setErrors((cur) => ({ ...cur, [s.project]: s.message ?? "原因不明のエラー" }));
        else if (s.state === "saved") {
          setErrors((cur) => {
            if (!(s.project in cur)) return cur;
            const { [s.project]: _removed, ...rest } = cur;
            return rest;
          });
        }
      }),
    [],
  );
  const clear = useCallback(() => setErrors({}), []);
  return { errors, clear };
}
