/** Spec ② §4.3: the body of the delete confirmation. */
export function deleteMessage(title: string, subtasks: number): string {
  return subtasks > 0 ? `「${title}」とサブタスク ${subtasks} 件を削除します。` : `「${title}」を削除します。`;
}

/** The subtasks (at any depth) that go with task `no`. */
export function countDescendants(tasks: { no: number; parentNo?: number }[], no: number): number {
  const kids = tasks.filter((t) => t.parentNo === no);
  return kids.reduce((n, k) => n + 1 + countDescendants(tasks, k.no), 0);
}

/** Enter confirms the delete once: not on auto-repeat, not during IME composition, not on another button (キャンセル). */
export function enterConfirms(e: { key: string; repeat: boolean; isComposing: boolean; keyCode: number }, onOtherButton: boolean): boolean {
  return e.key === "Enter" && !e.repeat && !e.isComposing && e.keyCode !== 229 && !onOtherButton;
}
