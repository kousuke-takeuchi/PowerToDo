import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArchiveRestore, ArrowUpDown, ChevronRight, CircleCheck, Ellipsis, LayoutList } from "lucide-react";
import { useEscLayer } from "../app/layers";
import { TopBarSlot } from "./TopBar";
import { isDefault, type Screen, type ViewOptions } from "../app/view/viewOptions";
import { ViewMenuPanel } from "./ViewMenuPanel";
import type { MenuEntry } from "./projectMenu";

/** What a screen passes to its header to get the working 表示 menu. */
export type HeaderView = { screen: Screen; options: ViewOptions; onChange: (o: ViewOptions) => void };

const smallButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "4px 8px",
  border: 0,
  borderRadius: 6,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

function HeaderAction({
  icon: Icon,
  label,
  onClick,
  menuOpen,
  dot,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label?: string;
  onClick?: () => void;
  /** 渡すとメニューを開くボタン (aria-haspopup / aria-expanded を付ける)。 */
  menuOpen?: boolean;
  /** A 6 px accent dot at the top right (the view differs from its defaults). */
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label ?? "その他"}
      aria-haspopup={menuOpen === undefined ? undefined : "menu"}
      aria-expanded={menuOpen}
      onClick={onClick}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={dot ? { ...smallButton, position: "relative" } : smallButton}
    >
      <Icon size={16} />
      {label}
      {dot && <span data-testid="view-dot" aria-hidden style={{ position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: 3, background: "var(--color-accent)" }} />}
    </button>
  );
}

/** 「その他」メニューの項目 (区切り線・「›」のサブメニューを含む)。空なら「…」のボタンは出さない。 */
export type HeaderMenu = MenuEntry[];

const menuItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  width: "100%",
  padding: "6px 12px",
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-primary)",
  textAlign: "left",
  cursor: "pointer",
};

const popover: React.CSSProperties = {
  minWidth: 200,
  padding: "4px 0",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  boxShadow: "var(--shadow-popover)",
};

const hint: React.CSSProperties = { fontSize: 12, color: "var(--color-text-muted)" };

function Separator() {
  return <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--color-border)" }} />;
}

/** メニューの 1 行。サブメニューは「›」で、ホバー / クリック / → で右に開く。 */
function EntryRow({ entry, run }: { entry: MenuEntry; run: (fn: () => void) => () => void }) {
  const [sub, setSub] = useState(false);
  if (entry.kind === "separator") return <Separator />;
  if (entry.kind === "item") {
    return (
      <button
        type="button"
        role="menuitem"
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={entry.danger ? { ...menuItem, color: "var(--color-danger)" } : menuItem}
        onClick={run(entry.onSelect)}
      >
        {entry.label}
        {entry.shortcut && <span style={hint}>{entry.shortcut}</span>}
      </button>
    );
  }
  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={sub}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={menuItem}
        onClick={() => setSub((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setSub(true);
          else if (e.key === "ArrowLeft") setSub(false);
        }}
      >
        {entry.label}
        <ChevronRight size={14} aria-hidden style={{ color: "var(--color-text-muted)" }} />
      </button>
      {sub && (
        <div role="menu" aria-label={entry.label} style={{ ...popover, position: "absolute", top: -5, right: "100%", marginRight: 2 }}>
          {entry.items.map((e, i) => (
            <EntryRow key={e.kind === "separator" ? `sep${i}` : e.id} entry={e} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 「その他」ボタン + 小さなポップオーバー。外側クリックと Esc で閉じる。 */
function MoreMenu({ entries, initialOpen = false }: { entries: MenuEntry[]; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEscLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <HeaderAction icon={Ellipsis} menuOpen={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div role="menu" aria-label="プロジェクトの操作" style={{ ...popover, position: "absolute", top: "100%", right: 0, zIndex: 10 }}>
          {entries.map((e, i) => (
            <EntryRow key={e.kind === "separator" ? `sep${i}` : e.id} entry={e} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 「表示」ボタン + メニュー。並び替えはここに入る (Todoist の Display)。並び替えはまだ動かないので押せない項目として出す。 */
function ViewMenu({ label, view, initialOpen = false }: { label: string; view?: HeaderView; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEscLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <HeaderAction icon={LayoutList} dot={view !== undefined && !isDefault(view.options)} label={label} menuOpen={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          role="menu"
          aria-label="表示"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 10,
            minWidth: 160,
            padding: view ? 0 : "4px 0",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: view ? 12 : 8,
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {view ? (
            <ViewMenuPanel screen={view.screen} options={view.options} onChange={view.onChange} />
          ) : (
            <button type="button" role="menuitem" disabled style={{ ...menuItem, display: "flex", alignItems: "center", gap: 8, color: "var(--color-text-muted)", cursor: "default" }}>
              <ArrowUpDown size={14} aria-hidden />
              並び替え
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 上の帯の右の 表示 / その他 (Todoist)。viewLabel は 表示 ボタンの文言 (ボード画面では「ボード」)。 */
export function HeaderActions({
  viewLabel = "表示",
  onMenu,
  onRestore,
  view,
  initialViewMenuOpen,
  initialMenuOpen,
}: {
  viewLabel?: string;
  onMenu?: HeaderMenu;
  /** アーカイブ済みのプロジェクトで「アーカイブから戻す」を出す。 */
  onRestore?: () => void;
  view?: HeaderView;
  initialViewMenuOpen?: boolean;
  /** Stories: the 「…」 menu starts open. */
  initialMenuOpen?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
      {onRestore && <HeaderAction icon={ArchiveRestore} label="アーカイブから戻す" onClick={onRestore} />}
      <ViewMenu label={viewLabel} view={view} initialOpen={initialViewMenuOpen} />
      {onMenu && onMenu.length > 0 && <MoreMenu entries={onMenu} initialOpen={initialMenuOpen} />}
    </div>
  );
}

/** 画面ヘッダー: children (タイトル群) をここに、HeaderActions は上の帯の右へ (AppShell の外では横に並べる)。 */
export function PageHeader({
  children,
  viewLabel,
  onMenu,
  onRestore,
  view,
  initialViewMenuOpen,
  initialMenuOpen,
}: {
  children: React.ReactNode;
  viewLabel?: string;
  onMenu?: HeaderMenu;
  onRestore?: () => void;
  view?: HeaderView;
  initialViewMenuOpen?: boolean;
  initialMenuOpen?: boolean;
}) {
  const slot = useContext(TopBarSlot);
  const actions = <HeaderActions viewLabel={viewLabel} onMenu={onMenu} onRestore={onRestore} view={view} initialViewMenuOpen={initialViewMenuOpen} initialMenuOpen={initialMenuOpen} />;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font-body)" }}>
      {children}
      {slot ? createPortal(actions, slot) : actions}
    </div>
  );
}

export const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 26,
  lineHeight: "36px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const subtitleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-secondary)",
};

/** The line under a page title, with a check icon (Todoist: 「✓ 6 件のタスク」). */
export function Subtitle({ text }: { text: string }) {
  return (
    <span style={subtitleStyle}>
      <CircleCheck size={14} aria-hidden />
      {text}
    </span>
  );
}

/** Title, and under it the subtitle line. */
export function TitleGroup({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h1 style={titleStyle}>{title}</h1>
      <Subtitle text={subtitle} />
    </div>
  );
}
