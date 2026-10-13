import { useState } from "react";
import type { Task } from "../types/model";

/** チェックの見た目だけをトグルする (データは変更しない)。 */
export function useDone() {
  const [override, setOverride] = useState<Map<number, boolean>>(() => new Map());
  const isDone = (t: Task) => override.get(t.no) ?? t.progress === 100;
  const toggle = (t: Task) => setOverride((m) => new Map(m).set(t.no, !isDone(t)));
  return { isDone, toggle };
}
