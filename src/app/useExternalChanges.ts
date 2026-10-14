import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { confirmAction } from "../api/dialogs";
import { onExitBlocked, onExternalChange, onExternalReadFailed, onProjectChanged, onProjectsChanged } from "../api/events";

/** 利用者に見せるファイル名。"_common" は共通設定のブック。 */
export function heldFileName(project: string): string {
  return project === "_common" ? "共通設定 (_PowerToDo.xlsx)" : `${project}.xlsx`;
}

/**
 * Excel など外でファイルが変わり、アプリにも未保存の変更があるプロジェクト (保存を止めて利用者の選択を待っている)。
 * `held` の正はバックエンドの held_projects: 起動時・フォルダ内の構成が変わったとき・プロジェクトが変わったとき
 * (project-changed、理由を問わない)・解決のあとに取り直す。`external-change` は取り直しを待たずに追加する。
 * reload_project / rename_project も保持を解く・付け替えるので、呼んだ側が終わったあとに `refresh()` を呼ぶ。
 */
export function useExternalChanges(onError: (e: unknown) => void) {
  const [held, setHeld] = useState<string[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refresh = useCallback(() => api.heldProjects().then(setHeld).catch(() => undefined), []);

  useEffect(() => {
    void refresh();
    // データフォルダの変更やファイルの削除でバックエンドが保持を解くので、一覧も取り直す
    return onProjectsChanged(() => void refresh());
  }, [refresh]);
  useEffect(() => onProjectChanged(() => void refresh()), [refresh]);
  useEffect(() => onExternalChange((p) => setHeld((h) => (h.includes(p) ? h : [...h, p]))), []);

  // 同じキーの確認を二重に開かない (ボタンの連打)
  const resolving = useRef(new Set<string>());
  const resolve = useCallback(
    async (project: string, action: "reload" | "overwrite") => {
      if (resolving.current.has(project)) return;
      resolving.current.add(project);
      try {
        const ok = await confirmAction(
          action === "reload"
            ? "このアプリでの変更は失われます。ファイルの内容を読み込みますか？"
            : "ファイル側の変更は失われます。このアプリの内容で上書きしますか？",
          { title: "外部での変更", okLabel: action === "reload" ? "ファイルを読み込む" : "上書きする" },
        ).catch(() => false);
        if (!ok) return;
        try {
          await api.resolveExternalChange(project, action);
        } catch (e) {
          onErrorRef.current(e);
        } finally {
          await refresh();
        }
      } finally {
        resolving.current.delete(project);
      }
    },
    [refresh],
  );

  // 終了しようとしたとき保持中のものがあった: 確認は 1 回。上書きがひとつでも失敗したら終了しない (未保存の内容を失わせない)。
  const exiting = useRef(false);
  useEffect(
    () =>
      onExitBlocked(async (projects) => {
        if (exiting.current) return;
        exiting.current = true;
        try {
          const ok = await confirmAction(
            `${projects.map((p) => `「${heldFileName(p)}」`).join("")}に、Excel での変更とこのアプリでの未保存の変更の両方があります。このアプリの内容で上書きして終了しますか？ (「終了しない」を選ぶと、アプリはそのまま開いています)`,
            { title: "終了", okLabel: "上書きして終了", cancelLabel: "終了しない" },
          ).catch(() => false);
          if (!ok) return;
          // 確認を出している間に新しく保持されたキーも上書きする (終了時の flush は保持中のものを書かない)
          const fresh = await api.heldProjects().catch(() => [] as string[]);
          const targets = [...new Set([...projects, ...fresh])];
          let failed = false;
          for (const p of targets) {
            try {
              await api.resolveExternalChange(p, "overwrite");
            } catch (e) {
              failed = true;
              onErrorRef.current(e);
            }
          }
          if (failed) {
            await refresh();
            return;
          }
          try {
            await api.quit();
          } catch (e) {
            onErrorRef.current(e);
          }
        } finally {
          exiting.current = false;
        }
      }),
    [refresh],
  );
  return { held, resolve, refresh };
}

/**
 * Excel など外で変わったファイルを読み込めなかったもの、{ project ("_common" を含む) -> message }。
 * 保存の失敗ではないので再試行は無い (次の変更イベントで読み直す)。帯は閉じるか、同じファイルの取り込みが
 * 成功したとき (project-changed の external、"_common" は projects-changed) に消える。
 * `clear()` はデータフォルダが変わったとき用。
 */
export function useExternalReadFailures() {
  const [failures, setFailures] = useState<Record<string, string>>({});
  const drop = useCallback(
    (project: string) =>
      setFailures((cur) => {
        if (!(project in cur)) return cur;
        const { [project]: _removed, ...rest } = cur;
        return rest;
      }),
    [],
  );
  useEffect(() => onExternalReadFailed((project, message) => setFailures((cur) => ({ ...cur, [project]: message }))), []);
  useEffect(
    () =>
      onProjectChanged((name, reason) => {
        if (reason === "external") drop(name);
      }),
    [drop],
  );
  useEffect(() => onProjectsChanged(() => drop("_common")), [drop]);
  const clear = useCallback(() => setFailures({}), []);
  return { failures, dismiss: drop, clear };
}
