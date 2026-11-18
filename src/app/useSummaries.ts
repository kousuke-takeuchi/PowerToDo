import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Counts } from "../mock/data";
import type { AppStateDto, CountsDto, ProjectSummary } from "../types/model";
import { useCrossView } from "./useCrossView";

/**
 * プロジェクト一覧 (件数つき)・「今日」の件数・表示名。デスクトップの Main とモバイルの MobileMain で共有する。
 * 件数は project-changed / 保存完了でも更新される (useCrossView)。
 */
export function useSummaries(app: AppStateDto, today: string) {
  const [allSummaries, setSummaries] = useState<ProjectSummary[]>(app.projects);
  // アーカイブ済みはサイドバーの専用の欄だけ。一覧・移動先・クイック追加の候補は `summaries` (アーカイブを除く)。
  const summaries = useMemo(() => allSummaries.filter((s) => !s.archived), [allSummaries]);
  const [displayName, setDisplayName] = useState<string | undefined>();

  // 「今日」の件数 (期限が今日以前の未完了)。
  const countsData = useCrossView<CountsDto>(() => api.counts(today), [today]);
  const refreshCounts = countsData.refresh;

  const refreshSummaries = useCallback(async () => {
    refreshCounts();
    try {
      setSummaries(await api.listProjects());
    } catch {
      // サイドバーの件数が古いままになるだけ。次の操作でまた更新する。
    }
  }, [refreshCounts]);

  const loadDisplayName = useCallback(() => {
    api
      .settings()
      .then((s) => setDisplayName(s.displayName || undefined))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshSummaries();
    loadDisplayName();
  }, [refreshSummaries, loadDisplayName]);

  const counts: Counts = useMemo(() => {
    const byName = Object.fromEntries(allSummaries.map((s) => [s.name, s.taskCount]));
    const inbox = allSummaries.find((s) => s.inbox);
    return { ...byName, inbox: inbox?.taskCount ?? 0, today: countsData.data?.today ?? 0 };
  }, [allSummaries, countsData.data]);

  return { summaries, allSummaries, displayName, setDisplayName, countsData, refreshSummaries, loadDisplayName, counts };
}
