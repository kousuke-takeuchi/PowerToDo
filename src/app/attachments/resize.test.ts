import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FILE_BYTES, extOf, imageKind, jpegName, planResize, sizeProblem } from "./resize.ts";

test("a_large_jpeg_shrinks_to_2048_on_the_long_side", () => {
  assert.deepEqual(planResize("jpeg", 4096, 3072), { action: "jpeg", w: 2048, h: 1536 });
  assert.deepEqual(planResize("jpeg", 3000, 6000), { action: "jpeg", w: 1024, h: 2048 });
});

test("a_large_png_becomes_a_jpeg_but_a_small_png_stays", () => {
  assert.equal(planResize("png", 2049, 100).action, "jpeg");
  assert.equal(planResize("png", 2048, 2048).action, "keep");
  assert.equal(planResize("png", 800, 600).action, "keep");
});

test("heic_is_always_a_jpeg_at_its_own_size_when_small", () => {
  assert.deepEqual(planResize("heic", 1000, 500), { action: "jpeg", w: 1000, h: 500 });
  assert.deepEqual(planResize("heic", 4000, 3000), { action: "jpeg", w: 2048, h: 1536 });
});

test("gif_and_unknown_kinds_are_kept_whatever_the_size", () => {
  assert.equal(planResize("gif", 5000, 5000).action, "keep");
  assert.equal(planResize("other", 5000, 5000).action, "keep");
});

test("a_very_thin_image_keeps_one_pixel", () => {
  assert.deepEqual(planResize("jpeg", 20000, 1), { action: "jpeg", w: 2048, h: 1 });
});

test("the_kind_comes_from_the_type_then_from_the_extension", () => {
  assert.equal(imageKind("image/png", "a.bin"), "png");
  assert.equal(imageKind("", "IMG_1.HEIC"), "heic");
  assert.equal(imageKind("application/pdf", "a.pdf"), "other");
  assert.equal(imageKind("", "noext"), "other");
});

test("the_jpeg_name_swaps_the_extension", () => {
  assert.equal(jpegName("スクショ.png"), "スクショ.jpg");
  assert.equal(jpegName("a.b.HEIC"), "a.b.jpg");
  assert.equal(jpegName("noext"), "noext.jpg");
  assert.equal(extOf(".hidden"), "");
});

test("a_file_over_50_mb_is_refused_with_its_name", () => {
  assert.equal(sizeProblem("a.pdf", MAX_FILE_BYTES), null);
  assert.match(sizeProblem("a.pdf", MAX_FILE_BYTES + 1)!, /a\.pdf/);
});
