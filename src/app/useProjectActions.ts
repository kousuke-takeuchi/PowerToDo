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

/** プロジェクトの作成 / 改名 / 削除とラベルの改名 / 削除 (受信トレイは改名・削除できない)。 */
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

  // ---- プロジェクトの改名 / 削除 (受信トレイは不可) ----
  const renameProject = async (newName: string) => {
    views.forget(viewKey("project", current));
    try {
      const renamed = await api.renameProject(current, newName);
      views.reload();
      await refreshSummaries();
      navigate({ kind: "project", name: renamed.name });
    } catch (e) {
      showError(e);
    } finally {
      // 保留中のプロジェクトは新しい名前で保留され直す (共通設定が保留になることもある)
      void ext.refresh();
    }
  };

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

  return { createProject, renameProject, deleteProject, deleteLabel, renameLabel };
}
