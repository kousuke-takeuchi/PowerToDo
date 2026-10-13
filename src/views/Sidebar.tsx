import type React from "react";
import { Bell, CalendarCheck, CalendarDays, CirclePlus, Inbox, LayoutGrid, PanelLeftClose, Plus, Search } from "lucide-react";
import { Button } from "../components/Button";
import { ProjectItem } from "../components/ProjectItem";
import { SidebarItem } from "../components/SidebarItem";
import { SyncStatus } from "../components/SyncStatus";
import type { SyncState } from "../components/SyncStatus";
import type { counts } from "../mock/data";
import type { Project } from "../types/model";

export type SidebarProps = {
  active: { kind: "inbox" | "today" | "upcoming" | "labels" | "project"; name?: string };
  counts: typeof counts;
  projects: Project[];
  syncState: SyncState;
  lastSyncedAt?: string;
  onNavigate?: (target: SidebarProps["active"]) => void;
  onAddTask?: () => void;
};

const heading: React.CSSProperties = {
  fontSize: 12,
  lineHeight: "17px",
  fontWeight: 700,
  color: "var(--color-text-secondary)",
};

export function Sidebar({ active, counts: c, projects, syncState, lastSyncedAt, onNavigate, onAddTask }: SidebarProps) {
  const countOf = (name: string) => (c as Record<string, number>)[name];
  const isActive = (kind: SidebarProps["active"]["kind"]) => active.kind === kind;
  const mine = projects.filter((p) => !p.inbox);
  const favorites = projects.filter((p) => p.favorite);
  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "12px 16px",
        background: "var(--color-bg-sidebar)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", height: 32 }}>
        <span aria-hidden style={{ width: 28, height: 28, borderRadius: 14, background: "var(--color-accent)", flex: "0 0 auto" }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          たろう
        </span>
        <Button variant="icon" icon={Bell} ariaLabel="通知" />
        <Button variant="icon" icon={PanelLeftClose} ariaLabel="サイドバーを閉じる" />
      </div>

      <button
        type="button"
        onClick={onAddTask}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "6px 10px",
          borderRadius: 6,
          border: 0,
          fontFamily: "var(--font-body)",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", color: "var(--color-accent)", flex: "0 0 auto" }}>
          <CirclePlus size={20} />
        </span>
        <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: "var(--color-accent)" }}>タスクを追加</span>
      </button>

      <nav aria-label="ナビゲーション" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <SidebarItem icon={Search} label="検索" />
        <SidebarItem
          icon={Inbox}
          label="受信トレイ"
          count={c.inbox}
          active={isActive("inbox")}
          onClick={() => onNavigate?.({ kind: "inbox" })}
        />
        <SidebarItem
          icon={CalendarCheck}
          label="今日"
          count={c.today}
          active={isActive("today")}
          onClick={() => onNavigate?.({ kind: "today" })}
        />
        <SidebarItem icon={CalendarDays} label="近日" active={isActive("upcoming")} onClick={() => onNavigate?.({ kind: "upcoming" })} />
        <SidebarItem
          icon={LayoutGrid}
          label="フィルターとラベル"
          active={isActive("labels")}
          onClick={() => onNavigate?.({ kind: "labels" })}
        />
      </nav>

      {favorites.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={heading}>お気に入り</div>
          {favorites.map((p) => (
            <ProjectItem key={p.name} color={p.color} label={p.name} count={countOf(p.name)} onClick={() => onNavigate?.({ kind: "project", name: p.name })} />
          ))}
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 32 }}>
          <span style={heading}>マイプロジェクト</span>
          <Button variant="icon" icon={Plus} ariaLabel="プロジェクトを追加" />
        </div>
        {mine.map((p) => (
          <ProjectItem
            key={p.name}
            color={p.color}
            label={p.name}
            count={countOf(p.name)}
            active={active.kind === "project" && active.name === p.name}
            onClick={() => onNavigate?.({ kind: "project", name: p.name })}
          />
        ))}
      </section>

      <div style={{ flex: 1 }} />
      <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} />
    </div>
  );
}
