import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Ellipsis, LayoutList } from "lucide-react";
import { useEscLayer } from "../app/layers";

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

/** 画面ヘッダー右の 表示 / 並び替え / その他 (pen の HeaderActions)。viewLabel は 表示 ボタンの文言 (ボード画面では「ボード」)。 */
export function HeaderActions({ viewLabel = "表示", onMenu }: { viewLabel?: string; onMenu?: HeaderMenu }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-1)" }}>
      <HeaderAction icon={LayoutList} label={viewLabel} />
      <HeaderAction icon={ArrowUpDown} label="並び替え" />
      {onMenu && (onMenu.rename || onMenu.delete) ? <MoreMenu menu={onMenu} /> : <HeaderAction icon={Ellipsis} />}
    </div>
  );
}

/** 画面ヘッダー (pen の Header): 左に children (タイトル群)、右に HeaderActions。 */
export function PageHeader({ children, viewLabel, onMenu }: { children: React.ReactNode; viewLabel?: string; onMenu?: HeaderMenu }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font-body)" }}>
      {children}
      <HeaderActions viewLabel={viewLabel} onMenu={onMenu} />
    </div>
  );
}

export const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: "35px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const subtitleStyle: React.CSSProperties = { fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" };

/** Title + Subtitle を下揃え (pen の TitleGroup, gap 12)。 */
export function TitleGroup({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
      <h1 style={titleStyle}>{title}</h1>
      <span style={subtitleStyle}>{subtitle}</span>
    </div>
  );
}
