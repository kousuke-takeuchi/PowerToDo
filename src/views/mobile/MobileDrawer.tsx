import type React from "react";
import { createContext } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, CalendarDays, Inbox, LayoutGrid, Search, Settings } from "lucide-react";
import { useEscLayer } from "../../app/layers";
import { ProjectItem } from "../../components/ProjectItem";
import { SidebarItem } from "../../components/SidebarItem";
import { SyncStatus, type SyncState } from "../../components/SyncStatus";
import type { Counts } from "../../mock/data";
import { useMotionTiming } from "../../motion";
import type { Project } from "../../types/model";
import { sheetTransition } from "./sheetMotion";

/** Opens the drawer from the top bar's menu button (MobileShell reads it, so the screens need no prop). Null: no button. */
export const MobileMenuContext = createContext<(() => void) | null>(null);

/** Where a drawer item goes. */
export type DrawerTarget = { kind: "inbox" | "today" | "upcoming" | "labels" | "search" | "settings" } | { kind: "project"; name: string };

export type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Shown at the top (the comment author name). Not set yet: 「アカウント」. */
  displayName?: string;
  projects: Project[];
  counts: Counts;
  /** The screen shown now (its row is grey). */
  active?: DrawerTarget;
  syncState: SyncState;
  lastSyncedAt?: string;
  syncOffText?: string;
  syncErrorText?: string;
  onSync?: () => void;
  /** Goes there; the caller closes the drawer. */
  onGo: (to: DrawerTarget) => void;
};

const heading: React.CSSProperties = { margin: "16px 0 4px", fontSize: 15, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" };

/** Opens on the screen's left side (85 %, at most 320) over a scrim. */
export const DRAWER_WIDTH = "min(320px, 85%)";

function Panel({ onClose, displayName, projects, counts, active, syncState, lastSyncedAt, syncOffText, syncErrorText, onSync, onGo }: Omit<MobileDrawerProps, "open">) {
  useEscLayer(true, onClose);
  const { reduced } = useMotionTiming();
  const open = sheetTransition("open", reduced);
  const close = sheetTransition("close", reduced);
  const is = (t: DrawerTarget) => active?.kind === t.kind && (t.kind !== "project" || (active.kind === "project" && active.name === t.name));
  const favorites = projects.filter((p) => p.favorite && !p.archived && !p.inbox);
  const mine = projects.filter((p) => !p.inbox && !p.archived);
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: open }}
      exit={{ opacity: 0, transition: close }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "absolute", inset: 0, background: "var(--color-scrim)", pointerEvents: "auto", fontFamily: "var(--font-body)" }}
    >
      <motion.nav
        aria-label="メニュー"
        initial={{ x: reduced ? 0 : "-100%" }}
        animate={{ x: 0, transition: open }}
        exit={{ x: reduced ? 0 : "-100%", transition: close }}
        // Swipe left to close (like the scrim tap).
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.6, right: 0 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -400) onClose();
        }}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg)",
          boxShadow: "var(--shadow-popover)",
          touchAction: "pan-y",
        }}
      >
        <div aria-hidden style={{ height: "env(safe-area-inset-top)", flex: "0 0 auto" }} />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 15px 16px" }}>
          <button
            type="button"
            onClick={() => onGo({ kind: "settings" })}
            aria-label="アカウントと設定"
            style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", minHeight: 44, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", textAlign: "left", cursor: "pointer" }}
          >
            <span aria-hidden style={{ width: 28, height: 28, borderRadius: 14, background: "var(--color-accent)", flex: "0 0 auto" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: "22px", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {displayName ?? "アカウント"}
            </span>
          </button>
          <div style={{ padding: "4px 0 8px" }}>
            <SyncStatus state={syncState} lastSyncedAt={lastSyncedAt} onClick={onSync} offText={syncOffText} errorText={syncErrorText} />
          </div>
          <SidebarItem mobile icon={Search} label="検索" active={is({ kind: "search" })} onClick={() => onGo({ kind: "search" })} />
          <SidebarItem mobile icon={Inbox} label="受信トレイ" count={counts.inbox} active={is({ kind: "inbox" })} onClick={() => onGo({ kind: "inbox" })} />
          <SidebarItem mobile icon={CalendarCheck} label="今日" count={counts.today} active={is({ kind: "today" })} onClick={() => onGo({ kind: "today" })} />
          <SidebarItem mobile icon={CalendarDays} label="近日" active={is({ kind: "upcoming" })} onClick={() => onGo({ kind: "upcoming" })} />
          <SidebarItem mobile icon={LayoutGrid} label="フィルターとラベル" active={is({ kind: "labels" })} onClick={() => onGo({ kind: "labels" })} />
          {favorites.length > 0 && (
            <>
              <h2 style={heading}>お気に入り</h2>
              {favorites.map((p) => (
                <ProjectItem mobile key={p.name} color={p.color} label={p.name} count={counts[p.name]} active={is({ kind: "project", name: p.name })} onClick={() => onGo({ kind: "project", name: p.name })} />
              ))}
            </>
          )}
          <h2 style={heading}>マイプロジェクト</h2>
          {mine.map((p) => (
            <ProjectItem mobile key={p.name} color={p.color} label={p.name} count={counts[p.name]} active={is({ kind: "project", name: p.name })} onClick={() => onGo({ kind: "project", name: p.name })} />
          ))}
        </div>
        <div style={{ flex: "0 0 auto", padding: "0 15px", boxShadow: "inset 0 1px 0 var(--color-border)" }}>
          <SidebarItem mobile icon={Settings} label="設定" active={is({ kind: "settings" })} onClick={() => onGo({ kind: "settings" })} />
          <div aria-hidden style={{ height: "env(safe-area-inset-bottom)" }} />
        </div>
      </motion.nav>
    </motion.div>
  );
}

/**
 * M-11 (spec 2026-11-22 §4): the left menu, the desktop sidebar's items in the same order. The top bar's menu button opens it;
 * an item goes there and closes it; the scrim or a swipe left closes it. Put it in MobileShell's overlay slot.
 */
export function MobileDrawer({ open, ...rest }: MobileDrawerProps) {
  return <AnimatePresence initial={false}>{open && <Panel key="drawer" {...rest} />}</AnimatePresence>;
}
