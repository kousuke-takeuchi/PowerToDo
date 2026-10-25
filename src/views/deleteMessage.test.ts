import { test } from "node:test";
import assert from "node:assert/strict";
import { countDescendants, deleteMessage, enterConfirms } from "./deleteMessage.ts";

test("delete_message_names_the_task_and_its_subtasks", () => {
  assert.equal(deleteMessage("牛乳を買う", 0), "「牛乳を買う」を削除します。");
  assert.equal(deleteMessage("資料を作る", 2), "「資料を作る」とサブタスク 2 件を削除します。");
});

test("descendants_count_children_and_grandchildren", () => {
  const t = (no: number, parentNo?: number) => ({ no, parentNo });
  assert.equal(countDescendants([t(1), t(2, 1), t(3, 2), t(4)], 1), 2);
  assert.equal(countDescendants([t(1), t(4)], 1), 0);
});

test("enter_confirms_only_once_and_not_on_another_button", () => {
  const k = { key: "Enter", repeat: false, isComposing: false, keyCode: 13 };
  assert.equal(enterConfirms(k, false), true);
  assert.equal(enterConfirms({ ...k, repeat: true }, false), false);
  assert.equal(enterConfirms({ ...k, keyCode: 229 }, false), false);
  assert.equal(enterConfirms(k, true), false);
  assert.equal(enterConfirms({ ...k, key: "a" }, false), false);
});
