import type React from "react";
import { CalendarCheck, CalendarDays, CirclePlus, Inbox, LayoutGrid, PanelLeftOpen, Search } from "lucide-react";
import { Button } from "../components/Button";
import { SyncStatus } from "../components/SyncStatus";
import type { SyncState } from "../components/SyncStatus";

export type SidebarRailProps = {
  syncState: SyncState;
  lastSyncedAt?: string;
  syncDetail?: string;
  onSyncClick?: () => void;
  onExpand?: () => void;
  onAddTask?: () => void;
  onNavigate?: (target: "search" | "inbox" | "today" | "upcoming" | "labels") => void;
};

function AccentCirclePlus(p: { size?: number }) {
  return <CirclePlus {...p} color="var(--color-accent)" />;
}

/** 幅 960 のサイドバー。アイコンだけ (プロジェクト一覧へは先頭の「一覧」アイコンで展開)。 */
export function SidebarRail({ syncState, lastSyncedAt, syncDetail, onSyncClick, onExpand, onAddTask, onNavigate }: SidebarRailProps) {
  const items: { icon: React.ComponentType<{ size?: number }>; label: string; target: Parameters<NonNullable<SidebarRailProps["onNavigate"]>>[0] }[] = [
    { icon: Search, label: "検索", target: "search" },
    { icon: Inbox, label: "受信トレイ", target: "inbox" },
    { icon: CalendarCheck, label: "今日", target: "today" },
    { icon: CalendarDays, label: "近日", target: "upcoming" },
    { icon: LayoutGrid, label: "フィルターとラベル", target: "labels" },
  ];
  return (
    <nav
      aria-label="サイドバー (最小表示)"
      style={{
        flex: "0 0 56px",
        width: 56,
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "12px 0",
        background: "var(--color-bg-sidebar)",
      }}
    >
      <Button variant="icon" icon={PanelLeftOpen} ariaLabel="サイドバーを開く" onClick={onExpand} />
      <Button variant="icon" icon={AccentCirclePlus} ariaLabel="タスクを追加" onClick={onAddTask} />
      {items.map((i) => (
        <Button key={i.target} variant="icon" icon={i.icon} ariaLabel={i.label} onClick={() => onNavigate?.(i.target)} />
      ))}
      <div style={{ flex: 1 }} />
      <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} detail={syncDetail} onClick={onSyncClick} compact />
    </nav>
  );
}
