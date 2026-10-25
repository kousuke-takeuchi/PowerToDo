/** Spec ② §4.3: the body of the delete confirmation. */
export function deleteMessage(title: string, subtasks: number): string {
  return subtasks > 0 ? `「${title}」とサブタスク ${subtasks} 件を削除します。` : `「${title}」を削除します。`;
}
