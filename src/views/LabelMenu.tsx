import type React from "react";
import { useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { useEscLayer } from "../app/layers";
import { EASE_CSS, useMotionTiming } from "../motion";
import { useOutsideClose } from "./crossList";

export type LabelMenuProps = {
  /** 選べる色 (CSS 変数 `var(--…)`)。 */
  palette: string[];
  /** 今のラベルの色。 */
  color: string;
  /** ボタンの aria-label に入れるラベル名 (省略すると「その他」)。 */
  name?: string;
  onRename(): void;
  onColor(c: string): void;
  onDelete(): void;
};

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

/** `var(--color-x)` から変数名 `--color-x` を取り出す (スウォッチの aria-label)。 */
function cssVarName(c: string): string {
  const m = /^var\((--[^,)\s]+)/.exec(c);
  return m ? m[1] : c;
}

/**
 * ラベル行の右端「その他」ボタン + ポップオーバー (名前を変更 / 色 / 削除)。
 * 行にホバーまたはフォーカスがあるときだけ見える (TaskRow の操作アイコンと同じ。親に `group` クラスが要る)。
 * 開いている間は出しっぱなし。外側クリックと Esc で閉じる。
 */
export function LabelMenu({ palette, color, name, onRename, onColor, onDelete }: LabelMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionTiming();
  useEscLayer(open, () => setOpen(false));
  useOutsideClose(ref, open, () => setOpen(false));
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div
      ref={ref}
      className={open ? undefined : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}
      style={{
        position: "relative",
        flex: "0 0 auto",
        opacity: open ? 1 : undefined,
        transition: reduced ? undefined : `opacity 120ms ${EASE_CSS}`,
      }}
    >
      <button
        type="button"
        aria-label={name ? `${name}の操作` : "その他"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={{
          width: 28,
          height: 28,
          display: "grid",
          placeItems: "center",
          padding: 0,
          border: 0,
          borderRadius: 6,
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        <Ellipsis size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="ラベルの操作"
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
          <button type="button" role="menuitem" className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={menuItem} onClick={run(onRename)}>
            名前を変更
          </button>
          <div role="group" aria-label="色" style={{ display: "flex", gap: "var(--space-2)", padding: "8px 12px" }}>
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={c === color}
                aria-label={cssVarName(c)}
                onClick={run(() => onColor(c))}
                style={{
                  width: 16,
                  height: 16,
                  padding: 0,
                  border: 0,
                  borderRadius: 8,
                  background: c,
                  boxShadow: c === color ? "0 0 0 2px var(--color-accent)" : undefined,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            className="bg-transparent hover:bg-[var(--color-bg-hover)]"
            style={{ ...menuItem, color: "var(--color-danger)" }}
            onClick={run(onDelete)}
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}
