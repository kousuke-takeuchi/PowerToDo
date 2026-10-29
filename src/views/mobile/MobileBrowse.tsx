import type React from "react";
import { Search, Settings, Tag } from "lucide-react";
import type { MobileTab } from "../../app/mobileNav";
import { ProjectItem } from "../../components/ProjectItem";
import { SidebarItem } from "../../components/SidebarItem";
import { SyncStatus, type SyncState } from "../../components/SyncStatus";
import type { Counts } from "../../mock/data";
import type { Project } from "../../types/model";
import { MobileShell } from "./MobileShell";

export type MobileBrowseProps = {
  projects: Project[];
  counts: Counts;
  syncState: SyncState;
  lastSyncedAt?: string;
  syncOffText?: string;
  syncErrorText?: string;
  /** The sync row (spec ④ iPhone §3.2): sync now, or open the sync settings when a sync cannot fix it (the caller decides). */
  onSync?: () => void;
  onOpenProject?: (name: string) => void;
  onOpenLabels?: () => void;
  onSearch?: () => void;
  onSettings?: () => void;
  fill?: boolean;
  today?: string;
  banner?: React.ReactNode;
  overlay?: React.ReactNode;
  onTabChange?: (t: MobileTab) => void;
  onFab?: () => void;
};

/** M-06 閲覧 (spec ④ iPhone §3.2): sync row, 「マイプロジェクト」 (inbox excluded: it has a tab), 「ラベル」. Search and settings in the top pill. */
export function MobileBrowse(p: MobileBrowseProps) {
  return (
    <MobileShell
      fill={p.fill}
      today={p.today}
      banner={p.banner}
      overlay={p.overlay}
      title="閲覧"
      largeTitle
      actions={[
        { icon: Search, label: "検索", onClick: p.onSearch },
        { icon: Settings, label: "設定", onClick: p.onSettings },
      ]}
      tab="browse"
      onTabChange={p.onTabChange}
      fab
      onFab={p.onFab}
    >
      <div style={{ padding: "0 15px" }}>
        <div style={{ padding: "8px 0" }}>
          <SyncStatus state={p.syncState} lastSyncedAt={p.lastSyncedAt} onClick={p.onSync} offText={p.syncOffText} errorText={p.syncErrorText} />
        </div>
        <h2 style={{ margin: "16px 0 4px", fontSize: 15, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>マイプロジェクト</h2>
        {p.projects
          .filter((x) => !x.inbox)
          .map((x) => (
            <ProjectItem mobile key={x.name} color={x.color} label={x.name} count={p.counts[x.name]} onClick={() => p.onOpenProject?.(x.name)} />
          ))}
        <div style={{ height: 16 }} />
        <SidebarItem mobile icon={Tag} label="ラベル" onClick={p.onOpenLabels} />
      </div>
    </MobileShell>
  );
}
