import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { LabelsDto, LabelViewDto, TodayViewDto, UpcomingDto } from "../types/model";
import type { SidebarProps } from "../views/Sidebar";
import { useCrossActions, useCrossView } from "./useCrossView";

type Nav = SidebarProps["active"];

/** 横断ビュー (今日 / 近日 / ラベル詳細 / ラベル一覧): 表示中のビューだけ取得する。 */
export function useCrossViews({
  nav,
  today,
  inbox,
  showError,
  refreshSummaries,
}: {
  nav: Nav;
  today: string;
  inbox: string;
  showError: (e: unknown) => void;
  refreshSummaries: () => Promise<void>;
}) {
  const inactive = () => Promise.resolve(null);
  const todayData = useCrossView<TodayViewDto | null>(nav.kind === "today" ? () => api.todayView(today) : inactive, [nav.kind === "today", today]);
  const [upFrom, setUpFrom] = useState(today);
  const [upDays, setUpDays] = useState(7);
  useEffect(() => {
    if (nav.kind !== "upcoming") {
      setUpFrom(today);
      setUpDays(7);
    }
  }, [nav.kind, today]);
  const upcomingData = useCrossView<UpcomingDto | null>(
    nav.kind === "upcoming" ? () => api.upcomingView(upFrom, upDays) : inactive,
    [nav.kind === "upcoming", upFrom, upDays],
  );
  // 「さらに 7 日」や月ジャンプで取り直す間は、前のグループを出したままにする (空表示と先頭へのスクロールを避ける)。
  const lastUpcoming = useRef<UpcomingDto | null>(null);
  if (nav.kind !== "upcoming") lastUpcoming.current = null;
  else if (upcomingData.data) lastUpcoming.current = upcomingData.data;
  const labelName = nav.kind === "label" ? nav.name : undefined;
  const labelData = useCrossView<LabelViewDto | null>(labelName ? () => api.labelView(labelName) : inactive, [labelName]);
  const labelsData = useCrossView<LabelsDto | null>(nav.kind === "labels" ? () => api.labels() : inactive, [nav.kind === "labels"]);
  const refreshAll = () => {
    todayData.refresh();
    upcomingData.refresh();
    labelData.refresh();
    void refreshSummaries(); // 件数 (今日 / プロジェクト) も更新する
  };
  const cross = useCrossActions(refreshAll, showError, inbox);
  return { todayData, upcomingData, lastUpcoming, upFrom, setUpFrom, upDays, setUpDays, labelData, labelsData, cross, refreshAll, labelName };
}
