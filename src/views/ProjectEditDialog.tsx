import { useState } from "react";
import { isImeKey } from "../app/keys";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

/** `var(--color-x)` から変数名 `--color-x` を取り出す (スウォッチの aria-label)。 */
function cssVarName(c: string): string {
  const m = /^var\((--[^,)\s]+)/.exec(c);
  return m ? m[1] : c;
}

/** The 「編集」 dialog of a project (spec 2026-11-18 §4): its name and its color. Enter saves, Esc cancels. */
export function ProjectEditDialog({
  name,
  color,
  palette,
  onCancel,
  onSave,
}: {
  name: string;
  color: string;
  /** 選べる色 (CSS 変数 `var(--…)`)。今の色が無ければ足して出す。 */
  palette: string[];
  onCancel: () => void;
  onSave: (name: string, color: string) => void;
}) {
  const [text, setText] = useState(name);
  const [picked, setPicked] = useState(color);
  useEscLayer(true, onCancel);
  const colors = palette.includes(color) ? palette : [color, ...palette];
  const valid = text.trim() !== "";
  const save = () => valid && onSave(text.trim(), picked);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="dialog"
        aria-label="プロジェクトの編集"
        style={{
          width: 384,
          boxSizing: "border-box",
          padding: "20px 16px 16px",
          borderRadius: 10,
          background: "var(--color-bg)",
          boxShadow: "var(--shadow-dialog)",
          fontFamily: "var(--font-body)",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px", color: "var(--color-text-primary)" }}>プロジェクトを編集</div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <TextField
            value={text}
            ariaLabel="プロジェクト名"
            placeholder="プロジェクト名"
            autoFocus
            onChange={setText}
            onKeyDown={(e) => {
              // IME 変換を確定する Enter は保存にしない (keys.ts)
              if (e.key === "Enter" && !isImeKey(e)) save();
            }}
          />
          <div role="radiogroup" aria-label="色" style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === picked}
                aria-label={cssVarName(c)}
                onClick={() => setPicked(c)}
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  border: 0,
                  borderRadius: 10,
                  background: c,
                  boxShadow: c === picked ? "0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent)" : undefined,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={save} disabled={!valid}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
