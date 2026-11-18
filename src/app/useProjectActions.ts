import { api } from "../api/client";
import { confirmAction } from "../api/dialogs";
import type { ProjectSummary } from "../types/model";
import type { useExternalChanges } from "./useExternalChanges";
import type { SidebarProps } from "../views/Sidebar";
import { viewKey } from "./view/viewOptions";

type Nav = SidebarProps["active"];

/** 新しいプロジェクトの色は順番に割り当てる。ラベルの「色」メニューの候補はこれに既定色を足したもの。 */
export const PALETTE = [
  "var(--color-priority-3)",
  "var(--color-success)",
  "var(--color-priority-2)",
  "var(--color-priority-4)",
  "var(--color-priority-1)",
];

/** プロジェクトの作成 / 編集 / お気に入り / アーカイブ / 削除とラベルの改名 / 削除。 */
export function useProjectActions({
  current,
  summaries,
  refreshSummaries,
  navigate,
  showError,
  ext,
  labelsData,
  views,
}: {
  current: string;
  summaries: ProjectSummary[];
  refreshSummaries: () => Promise<void>;
  navigate: (target: Nav) => void;
  showError: (e: unknown) => void;
  ext: ReturnType<typeof useExternalChanges>;
  labelsData: { refresh: () => void };
  /** The 表示 store: the backend moves / removes the row on a rename / delete, so drop the old key's pending write and reload. */
  views: { reload: () => void; forget: (key: string) => void };
}) {
  const createProject = async (name: string) => {
    try {
      const color = PALETTE[summaries.filter((s) => !s.inbox).length % PALETTE.length];
      const created = await api.createProject(name, color);
      await refreshSummaries();
      navigate({ kind: "project", name: created.name });
    } catch (e) {
      showError(e);
    }
  };

  // ---- プロジェクトの編集 (名前と色) / お気に入り / アーカイブ / ファイル (受信トレイは改名・アーカイブ・削除できない) ----
  const saveProject = async (newName: string, color: string) => {
    const renaming = newName !== current;
    if (renaming) views.forget(viewKey("project", current));
    try {
      const saved = await api.updateProject(current, newName, color);
      if (renaming) views.reload();
      await refreshSummaries();
      if (renaming) navigate({ kind: "project", name: saved.name });
    } catch (e) {
      showError(e);
    } finally {
      // 保留中のプロジェクトは新しい名前で保留され直す (共通設定が保留になることもある)
      void ext.refresh();
    }
  };

  const setFavorite = async (favorite: boolean) => {
    try {
      await api.setProjectFavorite(current, favorite);
      await refreshSummaries();
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh();
    }
  };

  /** アーカイブする (受信トレイへ戻る) / アーカイブから戻す (その場に残る)。ファイルはそのまま。 */
  const setArchived = async (archived: boolean) => {
    try {
      await api.setProjectArchived(current, archived);
      await refreshSummaries();
      if (archived) navigate({ kind: "inbox" });
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh();
    }
  };

  const openFile = () => void api.openProjectFile(current).catch(showError);
  const revealFile = () => void api.revealProjectFile(current).catch(showError);

  const deleteProject = async () => {
    const ok = await confirmAction(`プロジェクト「${current}」を削除します (archive フォルダに移動)。`, {
      title: "プロジェクトの削除",
      okLabel: "削除",
    }).catch(() => false);
    if (!ok) return;
    views.forget(viewKey("project", current));
    try {
      await api.deleteProject(current);
      views.reload();
      await refreshSummaries();
      navigate({ kind: "inbox" });
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh();
    }
  };

  const deleteLabel = async (name: string) => {
    const ok = await confirmAction(`ラベル「${name}」を削除します。付いているタスクからも外れます。`, {
      title: "ラベルの削除",
      okLabel: "削除",
    }).catch(() => false);
    if (!ok) return;
    views.forget(viewKey("label", name));
    try {
      await api.deleteLabel(name);
      views.reload();
      labelsData.refresh();
    } catch (e) {
      showError(e);
    }
  };

  const renameLabel = async (name: string, newName: string) => {
    views.forget(viewKey("label", name));
    try {
      await api.renameLabel(name, newName);
      views.reload();
      labelsData.refresh();
    } catch (e) {
      showError(e);
    }
  };

  return { createProject, saveProject, setFavorite, setArchived, openFile, revealFile, deleteProject, deleteLabel, renameLabel };
}
