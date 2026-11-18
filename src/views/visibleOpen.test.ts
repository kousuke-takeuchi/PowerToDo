import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "../types/model";
import { visibleOpen } from "./visibleOpen.ts";

const t = (no: number, progress: number, parentNo?: number, project = "a"): Task => ({
  no, project, category: null, title: `t${no}`, assignee: "", priority: 4, progress, parentNo, labels: [], reminders: [], order: 0, createdAt: "2026-10-10T09:00",
});

test("visibleOpen keeps open rows whose ancestors are all open", () => {
  const tasks = [t(1, 0), t(2, 100), t(3, 0, 1), t(4, 0, 2), t(5, 0, 4), t(6, 0, 3), t(7, 0, 99), t(1, 100, undefined, "b"), t(8, 0, 1, "b")];
  assert.deepEqual(
    visibleOpen(tasks).map((x) => `${x.project}${x.no}`),
    ["a1", "a3", "a6"],
  );
});
