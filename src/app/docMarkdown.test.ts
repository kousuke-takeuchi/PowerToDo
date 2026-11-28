import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentOfSrc, srcOfAttachment, DOC_TEMPLATE, isEmptyBody } from "./docMarkdown.ts";

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
