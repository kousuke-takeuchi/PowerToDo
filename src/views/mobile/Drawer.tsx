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
import type { SidebarProps } from "../Sidebar";

export type DrawerProps = {
  counts: Counts;
  projects: Project[];
  syncState?: SyncState;
  lastSyncedAt?: string;
  onClose?: () => void;
  onSettings?: () => void;
  /** 項目を選んだとき (受信トレイ / 今日 / 近日 / フィルターとラベル / プロジェクト)。 */
  onNavigate?: (nav: SidebarProps["active"]) => void;
  /** 最初に選択表示にする項目 (ラベル詳細は「フィルターとラベル」)。 */
  active?: SidebarProps["active"];
  /** 見出しの名前。省略すると絵のまま。 */
  displayName?: string;
  /** 同期の行を押したとき (今すぐ同期)。省略すると押せない。 */
  onSyncClick?: () => void;
  syncOffText?: string;
  syncErrorText?: string;
  /** 実機用: 上の余白をノッチのセーフエリアにする (下のセーフエリアも足す)。 */
  safeArea?: boolean;
};

/**
 * M-06: 左から出る幅 300 のドロワー (背面の scrim をタップすると onClose)。MobileShell の overlay スロットに入れる。
 * scrim は pointerEvents: "auto" (MobileShell の overlay ラッパーは "none")。
 */
export function Drawer({
  counts,
  projects,
  syncState = "syncing",
  lastSyncedAt,
  onClose,
  onSettings,
  onNavigate,
  active,
  displayName,
  onSyncClick,
  syncOffText,
  syncErrorText,
  safeArea,
}: DrawerProps) {
  // 選択行のハイライトだけ内部で持つ (pen の M-06 は何も選択していない)。画面遷移は Story を切り替える。
  const initial = !active ? null : active.kind === "inbox" ? "受信トレイ" : active.kind === "today" ? "今日" : active.kind === "upcoming" ? "近日" : active.kind === "project" ? (active.name ?? null) : "フィルターとラベル";
  const [selected, setSelected] = useState<string | null>(initial);
  const nav = (label: string, target: SidebarProps["active"]) => ({
    active: selected === label,
    onClick: () => {
      setSelected(label);
      onNavigate?.(target);
    },
  });
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
          padding: safeArea ? "calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 12px) 12px" : "60px 12px 24px 12px",
          background: "var(--color-bg-sidebar)",
          overflowY: "auto",
          color: "var(--color-text-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span aria-hidden style={{ width: 32, height: 32, borderRadius: 16, background: "var(--color-accent)", flex: "0 0 auto" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600 }}>{displayName ?? "たろう"}</span>
          <Button variant="icon" icon={Settings} ariaLabel="設定" onClick={onSettings} />
        </div>
        <nav aria-label="ナビゲーション" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SidebarItem icon={Inbox} label="受信トレイ" count={counts.inbox} {...nav("受信トレイ", { kind: "inbox" })} />
          <SidebarItem icon={CalendarCheck} label="今日" count={counts.today} {...nav("今日", { kind: "today" })} />
          <SidebarItem icon={CalendarDays} label="近日" {...nav("近日", { kind: "upcoming" })} />
          <SidebarItem icon={LayoutGrid} label="フィルターとラベル" {...nav("フィルターとラベル", { kind: "labels" })} />
        </nav>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 12, lineHeight: "17px", fontWeight: 700, color: "var(--color-text-secondary)" }}>マイプロジェクト</div>
          {projects
            .filter((p) => !p.inbox)
            .map((p) => (
              <ProjectItem key={p.name} color={p.color} label={p.name} count={counts[p.name]} {...nav(p.name, { kind: "project", name: p.name })} />
            ))}
        </div>
        <div style={{ flex: 1 }} />
        <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} onClick={onSyncClick} offText={syncOffText} errorText={syncErrorText} />
      </motion.aside>
    </motion.div>
  );
}
