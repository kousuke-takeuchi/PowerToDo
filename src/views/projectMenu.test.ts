import { test } from "node:test";
import assert from "node:assert/strict";
import { projectMenuEntries, revealLabel, type MenuEntry, type ProjectMenuActions } from "./projectMenu.ts";

const noop = () => undefined;
const actions: ProjectMenuActions = { edit: noop, toggleFavorite: noop, addSection: noop, openFile: noop, revealFile: noop, archive: noop, delete: noop };

/** The menu as text: items by label, `---` for a separator, `label > (...)` for a submenu. */
function shape(entries: MenuEntry[]): string[] {
  return entries.map((e) => (e.kind === "separator" ? "---" : e.kind === "submenu" ? `${e.label} > (${shape(e.items).join(", ")})` : e.label));
}

test("project_menu_follows_the_spec_order_and_separators", () => {
  assert.deepEqual(shape(projectMenuEntries({ inbox: false, favorite: false, os: "macos", actions })), [
    "編集",
    "お気に入りに追加",
    "セクションを追加",
    "---",
    "データを管理 > (Excel で開く, Finder で表示)",
    "---",
    "アーカイブ",
    "削除",
  ]);
});

test("favorite_label_flips_and_delete_is_danger", () => {
  const entries = projectMenuEntries({ inbox: false, favorite: true, os: "macos", actions });
  assert.ok(shape(entries).includes("お気に入りから外す"));
  const del = entries.find((e) => e.kind === "item" && e.id === "delete");
  assert.equal(del?.kind === "item" && del.danger, true);
});

test("inbox_menu_has_only_sections_and_data", () => {
  assert.deepEqual(shape(projectMenuEntries({ inbox: true, favorite: false, os: "macos", actions })), [
    "セクションを追加",
    "---",
    "データを管理 > (Excel で開く, Finder で表示)",
  ]);
});

test("windows_says_explorer", () => {
  assert.equal(revealLabel("windows"), "エクスプローラーで表示");
  assert.ok(shape(projectMenuEntries({ inbox: false, favorite: false, os: "windows", actions })).some((l) => l.includes("エクスプローラーで表示")));
});

test("add_section_carries_the_s_shortcut_hint", () => {
  const e = projectMenuEntries({ inbox: false, favorite: false, os: "macos", actions }).find((x) => x.kind === "item" && x.id === "add-section");
  assert.equal(e?.kind === "item" && e.shortcut, "S");
});

test("archived_project_menu_is_data_and_delete_only", () => {
  assert.deepEqual(shape(projectMenuEntries({ inbox: false, archived: true, favorite: false, os: "macos", actions })), [
    "データを管理 > (Excel で開く, Finder で表示)",
    "---",
    "削除",
  ]);
});
