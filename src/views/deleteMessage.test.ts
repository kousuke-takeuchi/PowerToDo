import { test } from "node:test";
import assert from "node:assert/strict";
import { countDescendants, deleteMessage } from "./deleteMessage.ts";

test("delete_message_names_the_task_and_its_subtasks", () => {
  assert.equal(deleteMessage("牛乳を買う", 0), "「牛乳を買う」を削除します。");
  assert.equal(deleteMessage("資料を作る", 2), "「資料を作る」とサブタスク 2 件を削除します。");
});

test("descendants_count_children_and_grandchildren", () => {
  const t = (no: number, parentNo?: number) => ({ no, parentNo });
  assert.equal(countDescendants([t(1), t(2, 1), t(3, 2), t(4)], 1), 2);
  assert.equal(countDescendants([t(1), t(4)], 1), 0);
});
