import { useState } from "react";
import { Plus, Tag } from "lucide-react";
import { isImeKey } from "../app/keys";
import { PopRow, PopoverShell } from "./PopoverShell";

/** Spec ① §2.4: add / remove labels; a name not in the list is created by using it (labels are implicit). */
export function LabelPicker({ labels, selected, onToggle }: { labels: string[]; selected: string[]; onToggle: (name: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const all = [...new Set([...labels, ...selected])];
  const shown = all.filter((l) => q === "" || l.toLowerCase().includes(q.toLowerCase()));
  const canCreate = q !== "" && !all.some((l) => l === q);
  return (
    <PopoverShell label="ラベル" gap="var(--space-1)">
      <input
        autoFocus
        aria-label="ラベルを探す"
        placeholder="ラベル名を入力"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || isImeKey(e)) return;
          if (canCreate) onToggle(q);
          else if (shown[0]) onToggle(shown[0]);
          setQuery("");
        }}
        style={{
          boxSizing: "border-box",
          width: "100%",
          padding: "6px 8px",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          background: "var(--color-bg)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
          lineHeight: "19px",
          outline: "none",
        }}
      />
      <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {shown.map((l) => (
          <PopRow key={l} icon={<Tag size={14} />} onClick={() => onToggle(l)} ariaLabel={l}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px" }}>@{l}</span>
            <input type="checkbox" readOnly checked={selected.includes(l)} tabIndex={-1} aria-hidden style={{ accentColor: "var(--color-accent)" }} />
          </PopRow>
        ))}
        {canCreate && (
          <PopRow icon={<Plus size={14} />} onClick={() => (onToggle(q), setQuery(""))}>
            <span style={{ fontSize: 13, lineHeight: "19px" }}>「{q}」を作成</span>
          </PopRow>
        )}
      </div>
    </PopoverShell>
  );
}
