import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachmentOfSrc,
  srcOfAttachment,
  DOC_TEMPLATE,
  isEmptyBody,
  imageBlockAltIn,
  imageBlockAltOut,
} from "./docMarkdown.ts";

test("an image path names a blob, and back", () => {
  const h = "b".repeat(64);
  assert.deepEqual(attachmentOfSrc(`../_attachments/${h}.png`), { hash: h, ext: "png" });
  assert.deepEqual(attachmentOfSrc(`../_attachments/${h}`), { hash: h, ext: "" });
  assert.equal(attachmentOfSrc("https://example.com/a.png"), null);
  assert.equal(attachmentOfSrc("../_attachments/short.png"), null);
  assert.equal(attachmentOfSrc(`../_attachments/${h}.PNG`), null);
  assert.equal(srcOfAttachment({ hash: h, ext: "png" }), `../_attachments/${h}.png`);
  assert.equal(srcOfAttachment({ hash: h, ext: "" }), `../_attachments/${h}`);
});

test("the template has the five headings", () => {
  assert.deepEqual(DOC_TEMPLATE.match(/^## .+$/gm), ["## 目的", "## 経緯", "## リンク", "## 要望", "## やりたいこと"]);
});

test("an empty body is whitespace or an empty paragraph", () => {
  assert.equal(isEmptyBody(""), true);
  assert.equal(isEmptyBody("\n\n"), true);
  assert.equal(isEmptyBody("<br />\n"), true);
  assert.equal(isEmptyBody("a"), false);
});

test("a block image's alt is text or the resize ratio", () => {
  assert.deepEqual(imageBlockAltIn("画面"), { alt: "画面", ratio: 1 });
  assert.deepEqual(imageBlockAltIn("0.50"), { alt: "", ratio: 0.5 });
  assert.deepEqual(imageBlockAltIn("0"), { alt: "", ratio: 1 });
  assert.deepEqual(imageBlockAltIn(""), { alt: "", ratio: 1 });
  assert.deepEqual(imageBlockAltIn(undefined), { alt: "", ratio: 1 });
  assert.equal(imageBlockAltOut("画面", 1), "画面");
  assert.equal(imageBlockAltOut("", 0.5), "0.50");
  assert.equal(imageBlockAltOut("", 1), "1.00");
});
