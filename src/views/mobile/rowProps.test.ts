import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileRowProps } from "./rowProps.ts";
import type { Task } from "../../types/model.ts";

const t = (p: Partial<Task>): Task => ({
  no: 1, project: "仕事", category: null, title: "週報を書く", assignee: "たろう", priority: 2, progress: 0,
  labels: [], reminders: [], order: 0, createdAt: "2026-10-01T09:00", ...p,
});
const ctx = { today: "2026-10-13", inbox: "受信トレイ", colors: { 仕事: "var(--color-priority-3)" }, comments: { "仕事/1": 2 } };

test("meta_line_parts", () => {
  const r = mobileRowProps(t({ due: "2026-10-12", rrule: "FREQ=DAILY", note: "一行目\n二行目" }), ctx, { project: true });
  assert.equal(r.description, "一行目");
  assert.deepEqual(r.date, { label: "昨日", tone: "danger" });
  assert.equal(r.recurring, true);
  assert.equal(r.commentCount, 2);
  assert.equal(r.project, "仕事");
  assert.equal(r.projectColor, "var(--color-priority-3)");
  assert.equal(r.projectIsInbox, undefined);
});

test("inbox_rows_show_the_inbox", () => {
  const r = mobileRowProps(t({ project: "受信トレイ" }), ctx, { project: true });
  assert.equal(r.project, "受信トレイ");
  assert.equal(r.projectIsInbox, true);
  assert.equal(r.projectColor, undefined);
});

test("hidden_parts_stay_off", () => {
  const r = mobileRowProps(t({ due: "2026-10-13" }), ctx, { date: false });
  assert.equal(r.date, undefined);
  assert.equal(r.project, undefined);
  assert.equal(r.commentCount, 2);
  assert.equal(mobileRowProps(t({ no: 9 }), ctx).commentCount, undefined);
  assert.equal(mobileRowProps(t({ note: "" }), ctx).description, undefined);
});
