import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api/client";
import type { QuickAddResult } from "../types/model";
import { spansToTokens } from "./quickAddTokens";
import type { useProject } from "./useProject";

type Flash = { text: string; tone: "error" | "info" };
type QuickAddState = { open: boolean; text: string; busy: boolean; error?: string; /** クイック追加の構文に無いので別に選ぶ。追加が成功したあと updateTask で付ける。 */ reminders: string[]; parsed?: { text: string; result: QuickAddResult } };

const QA_CLOSED: QuickAddState = { open: false, text: "", busy: false, reminders: [] };

/** クイック追加ダイアログの状態・プレビュー (parse_quick_add)・送信。 */
export function useQuickAdd({
  p,
  current,
  setFlash,
}: {
  p: ReturnType<typeof useProject>;
  current: string;
  setFlash: (flash: Flash) => void;
}) {
  const [qa, setQa] = useState<QuickAddState>(QA_CLOSED);
  const openQuickAdd = useCallback(() => setQa((s) => (s.open ? s : { ...QA_CLOSED, open: true })), []);
  const closeQuickAdd = useCallback(() => setQa(QA_CLOSED), []);
  const setText = (text: string) => setQa((s) => ({ ...s, text, error: undefined }));

  // クイック追加のプレビュー: 入力が止まってから parse_quick_add を呼ぶ。結果は解析した文字列とセットで持つ。
  useEffect(() => {
    if (!qa.open || !qa.text.trim()) return;
    const text = qa.text;
    let cancelled = false;
    const id = window.setTimeout(() => {
      p.parseQuickAdd(text)
        .then((result) => {
          if (!cancelled) setQa((s) => (s.text === text ? { ...s, parsed: { text, result } } : s));
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [qa.open, qa.text, p.parseQuickAdd]);

  const setReminders = (reminders: string[]) => setQa((s) => ({ ...s, reminders }));

  const submit = async (text: string) => {
    setQa((s) => ({ ...s, busy: true, error: undefined }));
    try {
      const out = await p.quickAdd(text);
      const reminders = qa.reminders;
      setQa(QA_CLOSED);
      if (reminders.length > 0) {
        // 追加は済んでいる。リマインダーだけ失敗したら知らせる (タスクは残る)。
        const ok =
          out.view.project.name === p.view?.project.name
            ? await p.updateTask(out.no, { reminders })
            : await api.updateTask(out.view.project.name, out.no, { reminders }).then(() => true, () => false);
        if (!ok) setFlash({ text: "タスクは追加しましたが、リマインダーを付けられませんでした", tone: "error" });
      }
      if (out.view.project.name !== current) setFlash({ text: `「${out.view.project.name}」に追加しました`, tone: "info" });
    } catch (e) {
      setQa((s) => ({ ...s, busy: false, error: errorMessage(e) }));
    }
  };

  // ---- クイック追加ダイアログに渡すもの ----
  const parsed = qa.parsed && qa.parsed.text === qa.text ? qa.parsed.result : undefined;
  const tokens = parsed ? spansToTokens(qa.text, parsed.spans) : qa.text ? [{ text: qa.text }] : [];
  const qaProject = parsed?.project ?? current;

  return { qa, openQuickAdd, closeQuickAdd, setText, setReminders, submit, tokens, qaProject };
}
