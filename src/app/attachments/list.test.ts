import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttachmentList, formatBytes, missingLabel, sameFiles, stepViewer, thumbBox } from "./list.ts";
import type { AttachmentInfo } from "../../types/model.ts";

const f = (name: string, type: string, extra: Partial<AttachmentInfo> = {}): AttachmentInfo => ({
  hash: name.padEnd(64, "0"),
  ext: name.split(".").pop()!,
  name,
  type,
  size: 2048,
  ...extra,
});

test("pictures_come_first_with_viewer_indexes_and_other_files_become_chips", () => {
  const { items, images } = buildAttachmentList([f("a.pdf", "application/pdf"), f("b.png", "image/png", { w: 800, h: 600 }), f("c.jpg", "image/jpeg", { w: 100, h: 100 })]);
  assert.deepEqual(items.map((i) => [i.kind, i.file.name]), [["image", "b.png"], ["image", "c.jpg"], ["chip", "a.pdf"]]);
  assert.deepEqual(images.map((i) => i.name), ["b.png", "c.jpg"]);
  const second = items[1];
  assert.equal(second.kind === "image" && second.viewIndex, 1);
});

test("an_image_the_webview_cannot_show_is_a_chip", () => {
  const { items } = buildAttachmentList([f("p.heic", "image/heic")]);
  assert.equal(items[0].kind, "chip");
});

test("thumbnails_are_at_most_120_high_and_320_wide", () => {
  assert.deepEqual(thumbBox(1600, 900), { w: 213, h: 120 });
  assert.deepEqual(thumbBox(4000, 100), { w: 320, h: 8 });
  assert.deepEqual(thumbBox(50, 40), { w: 50, h: 40 });
  assert.deepEqual(thumbBox(), { w: 120, h: 120 });
});

test("sizes_read_in_kb_and_mb", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(183204), "179 KB");
  assert.equal(formatBytes(3 * 1024 * 1024 + 512 * 1024), "3.5 MB");
});

test("the_viewer_stops_at_both_ends", () => {
  assert.equal(stepViewer(0, -1, 3), 0);
  assert.equal(stepViewer(2, 1, 3), 2);
  assert.equal(stepViewer(1, 1, 3), 2);
});

test("an_edit_that_changes_no_file_is_noticed", () => {
  const a = [f("a.png", "image/png")];
  assert.equal(sameFiles(a, [{ ...a[0] }]), true);
  assert.equal(sameFiles(a, []), false);
});

test("a_missing_blob_reads_syncing_until_the_sync_is_over", () => {
  assert.equal(missingLabel(true), "同期中");
  assert.equal(missingLabel(false), "見つかりません");
});
