import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_NAV, crossNavOf, projectOf, reduceNav, screenOf } from "./mobileNav.ts";

const go = (...actions: Parameters<typeof reduceNav>[1][]) => actions.reduce(reduceNav, INITIAL_NAV);

test("starts_on_the_inbox", () => {
  assert.deepEqual(screenOf(INITIAL_NAV), { kind: "inbox" });
  assert.equal(projectOf(INITIAL_NAV, "受信トレイ"), "受信トレイ");
});

test("push_and_back", () => {
  const s = go({ type: "tab", tab: "browse" }, { type: "push", screen: { kind: "labels" } }, { type: "push", screen: { kind: "label", name: "急ぎ" } });
  assert.deepEqual(screenOf(s), { kind: "label", name: "急ぎ" });
  assert.deepEqual(crossNavOf(s), { kind: "label", name: "急ぎ" });
  assert.deepEqual(screenOf(reduceNav(s, { type: "back" })), { kind: "labels" });
  assert.deepEqual(screenOf(go({ type: "tab", tab: "browse" }, { type: "back" })), { kind: "browse" });
});

test("tab_retap_pops_browse_to_root", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } }, { type: "tab", tab: "browse" });
  assert.deepEqual(screenOf(s), { kind: "browse" });
});

test("other_tabs_keep_the_browse_stack", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } }, { type: "tab", tab: "today" });
  assert.deepEqual(screenOf(s), { kind: "today" });
  assert.equal(projectOf(s, "受信トレイ"), "受信トレイ");
  const back = reduceNav(s, { type: "tab", tab: "browse" });
  assert.deepEqual(screenOf(back), { kind: "project", name: "仕事" });
  assert.equal(projectOf(back, "受信トレイ"), "仕事");
});

test("renamed_and_removed_follow_the_project", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } });
  assert.deepEqual(screenOf(reduceNav(s, { type: "renamed", from: "仕事", to: "業務" })), { kind: "project", name: "業務" });
  assert.deepEqual(screenOf(reduceNav(s, { type: "removed", project: "仕事" })), { kind: "browse" });
  assert.deepEqual(reduceNav(s, { type: "removed", project: "買い物" }), s);
});

test("cross_nav_of_each_tab", () => {
  assert.deepEqual(crossNavOf(go({ type: "tab", tab: "today" })), { kind: "today" });
  assert.deepEqual(crossNavOf(go({ type: "tab", tab: "upcoming" })), { kind: "upcoming" });
  assert.deepEqual(crossNavOf(go({ type: "push", screen: { kind: "search" } })), { kind: "inbox" });
  assert.deepEqual(crossNavOf(go({ type: "push", screen: { kind: "labels" } })), { kind: "labels" });
});
