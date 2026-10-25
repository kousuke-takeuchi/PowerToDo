import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, CircleCheck, Ellipsis, LayoutList } from "lucide-react";
import { useEscLayer } from "../app/layers";
import { TopBarSlot } from "./TopBar";

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
}: {
  icon: React.ComponentType<{ size?: number }>;
  label?: string;
  onClick?: () => void;
  /** 渡すとメニューを開くボタン (aria-haspopup / aria-expanded を付ける)。 */
  menuOpen?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label ?? "その他"}
      aria-haspopup={menuOpen === undefined ? undefined : "menu"}
      aria-expanded={menuOpen}
      onClick={onClick}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={smallButton}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

/** 「その他」メニューの項目。渡した項目だけが出る。 */
export type HeaderMenu = { rename?: () => void; delete?: () => void };

const menuItem: React.CSSProperties = {
  display: "block",
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

/** 「その他」ボタン + 小さなポップオーバー (名前を変更 / 削除)。外側クリックと Esc で閉じる。 */
function MoreMenu({ menu }: { menu: HeaderMenu }) {
  const [open, setOpen] = useState(false);
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
        <div
          role="menu"
          aria-label="プロジェクトの操作"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 10,
            minWidth: 160,
            padding: "4px 0",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {menu.rename && (
            <button type="button" role="menuitem" className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={menuItem} onClick={run(menu.rename)}>
              名前を変更
            </button>
          )}
          {menu.delete && (
            <button
              type="button"
              role="menuitem"
              className="bg-transparent hover:bg-[var(--color-bg-hover)]"
              style={{ ...menuItem, color: "var(--color-danger)" }}
              onClick={run(menu.delete)}
            >
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 「表示」ボタン + メニュー。並び替えはここに入る (Todoist の Display)。並び替えはまだ動かないので押せない項目として出す。 */
function ViewMenu({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
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
      <HeaderAction icon={LayoutList} label={label} menuOpen={open} onClick={() => setOpen((v) => !v)} />
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
            padding: "4px 0",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-popover)",
          }}
        >
          <button type="button" role="menuitem" disabled style={{ ...menuItem, display: "flex", alignItems: "center", gap: 8, color: "var(--color-text-muted)", cursor: "default" }}>
            <ArrowUpDown size={14} aria-hidden />
            並び替え
          </button>
        </div>
      )}
    </div>
  );
}

/** 上の帯の右の 表示 / その他 (Todoist)。viewLabel は 表示 ボタンの文言 (ボード画面では「ボード」)。 */
export function HeaderActions({ viewLabel = "表示", onMenu }: { viewLabel?: string; onMenu?: HeaderMenu }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
      <ViewMenu label={viewLabel} />
      {onMenu && (onMenu.rename || onMenu.delete) ? <MoreMenu menu={onMenu} /> : <HeaderAction icon={Ellipsis} />}
    </div>
  );
}

/** 画面ヘッダー: children (タイトル群) をここに、HeaderActions は上の帯の右へ (AppShell の外では横に並べる)。 */
export function PageHeader({ children, viewLabel, onMenu }: { children: React.ReactNode; viewLabel?: string; onMenu?: HeaderMenu }) {
  const slot = useContext(TopBarSlot);
  const actions = <HeaderActions viewLabel={viewLabel} onMenu={onMenu} />;
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
