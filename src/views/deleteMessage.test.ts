import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteMessage } from "./deleteMessage.ts";

test("delete_message_names_the_task_and_its_subtasks", () => {
  assert.equal(deleteMessage("牛乳を買う", 0), "「牛乳を買う」を削除します。");
  assert.equal(deleteMessage("資料を作る", 2), "「資料を作る」とサブタスク 2 件を削除します。");
});
