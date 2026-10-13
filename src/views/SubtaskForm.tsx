import { Bell, Calendar, Flag, Tag } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../components/Button";

export type SubtaskFormProps = {
  defaultTitle?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onSubmit?: (title: string) => void;
};

const bare: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  fontFamily: "var(--font-body)",
};

const toolbar: { icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { icon: Calendar, label: "期限" },
  { icon: Flag, label: "優先度" },
  { icon: Bell, label: "リマインダー" },
  { icon: Tag, label: "ラベル" },
];

/** インラインのサブタスク追加フォーム (D-01c)。保存はしない (見た目と開閉だけ)。 */
export function SubtaskForm({ defaultTitle = "", autoFocus, onCancel, onSubmit }: SubtaskFormProps) {
  const [title, setTitle] = useState(defaultTitle);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSubmit?.(title);
      }}
      style={{
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-3)",
        background: "var(--color-bg)",
        boxShadow: "inset 0 0 0 1px var(--color-border)",
        borderRadius: "var(--radius)",
        fontFamily: "var(--font-body)",
      }}
    >
      <input
        aria-label="サブタスク名"
        autoFocus={autoFocus}
        value={title}
        placeholder="サブタスク名"
        onChange={(e) => setTitle(e.target.value)}
        className="placeholder:text-[var(--color-text-muted)]"
        style={{ ...bare, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" }}
      />
      <input
        aria-label="説明"
        placeholder="説明"
        className="placeholder:text-[var(--color-text-muted)]"
        style={{ ...bare, fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}
      />
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {toolbar.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className="bg-transparent hover:bg-[var(--color-bg-hover)]"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              padding: "4px 8px",
              border: 0,
              boxShadow: "inset 0 0 0 1px var(--color-border)",
              borderRadius: 6,
              fontFamily: "var(--font-body)",
              fontSize: 13,
              lineHeight: "19px",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <Button variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={!title.trim()}>
          サブタスクを追加
        </Button>
      </div>
    </form>
  );
}
