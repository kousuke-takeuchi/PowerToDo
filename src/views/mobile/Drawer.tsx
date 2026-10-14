import { useState } from "react";
import { motion } from "motion/react";
import { CalendarCheck, CalendarDays, Inbox, LayoutGrid, Settings } from "lucide-react";
import { Button } from "../../components/Button";
import { ProjectItem } from "../../components/ProjectItem";
import { SidebarItem } from "../../components/SidebarItem";
import { SyncStatus } from "../../components/SyncStatus";
import type { SyncState } from "../../components/SyncStatus";
import { useMotionTiming } from "../../motion";
import type { Counts } from "../../mock/data";
import type { Project } from "../../types/model";

export type DrawerProps = {
  counts: Counts;
  projects: Project[];
  syncState?: SyncState;
  lastSyncedAt?: string;
  onClose?: () => void;
  onSettings?: () => void;
};

/**
 * M-06: 左から出る幅 300 のドロワー (背面の scrim をタップすると onClose)。MobileShell の overlay スロットに入れる。
 * scrim は pointerEvents: "auto" (MobileShell の overlay ラッパーは "none")。
 */
export function Drawer({ counts, projects, syncState = "syncing", lastSyncedAt, onClose, onSettings }: DrawerProps) {
  // 選択行のハイライトだけ内部で持つ (pen の M-06 は何も選択していない)。画面遷移は Story を切り替える。
  const [selected, setSelected] = useState<string | null>(null);
  const nav = (label: string) => ({ active: selected === label, onClick: () => setSelected(label) });
  // scrim は 150ms でフェード、ドロワーは左から 250ms でスライド。reduced motion では動かさない。
  const { reduced, t } = useMotionTiming();
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={t(0.15)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{ width: "100%", height: "100%", background: "var(--color-scrim)", pointerEvents: "auto", fontFamily: "var(--font-body)" }}
    >
      <motion.aside
        aria-label="ドロワー"
        initial={{ x: reduced ? 0 : "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: reduced ? 0 : "-100%" }}
        transition={t(0.25)}
        style={{
          boxSizing: "border-box",
          width: 300,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "60px 12px 24px 12px",
          background: "var(--color-bg-sidebar)",
          color: "var(--color-text-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span aria-hidden style={{ width: 32, height: 32, borderRadius: 16, background: "var(--color-accent)", flex: "0 0 auto" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600 }}>たろう</span>
          <Button variant="icon" icon={Settings} ariaLabel="設定" onClick={onSettings} />
        </div>
        <nav aria-label="ナビゲーション" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SidebarItem icon={Inbox} label="受信トレイ" count={counts.inbox} {...nav("受信トレイ")} />
          <SidebarItem icon={CalendarCheck} label="今日" count={counts.today} {...nav("今日")} />
          <SidebarItem icon={CalendarDays} label="近日" {...nav("近日")} />
          <SidebarItem icon={LayoutGrid} label="フィルターとラベル" {...nav("フィルターとラベル")} />
        </nav>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 12, lineHeight: "17px", fontWeight: 700, color: "var(--color-text-secondary)" }}>マイプロジェクト</div>
          {projects
            .filter((p) => !p.inbox)
            .map((p) => (
              <ProjectItem key={p.name} color={p.color} label={p.name} count={counts[p.name]} {...nav(p.name)} />
            ))}
        </div>
        <div style={{ flex: 1 }} />
        <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} />
      </motion.aside>
    </motion.div>
  );
}
