import { useState } from "react";
import { Check, Hash, LayoutList } from "lucide-react";
import { isImeKey } from "../app/keys";
import { PopRow, PopoverShell } from "./PopoverShell";

export type PickerProject = { name: string; sections: string[] };

/** One choice of the picker: a project, or a section of it. */
type Choice = { project: string; section: string | null };

const field = {
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
} as const;

/** Choices matching `query` (case-insensitive, project or section name), in list order. */
export function projectChoices(projects: PickerProject[], query: string): Choice[] {
  const q = query.trim().toLowerCase();
  const out: Choice[] = [];
  for (const p of projects) {
    const hit = (s: string) => q === "" || s.toLowerCase().includes(q);
    if (hit(p.name)) out.push({ project: p.name, section: null });
    for (const s of p.sections) if (hit(p.name) || hit(s)) out.push({ project: p.name, section: s });
  }
  return out;
}

/** Spec ① §2.4: where to move the task (a project, or a section of it). Enter picks the first match. */
export function ProjectPicker({
  projects,
  current,
  onPick,
}: {
  projects: PickerProject[];
  current: Choice;
  onPick: (project: string, section: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const list = projectChoices(projects, query);
  return (
    <PopoverShell label="プロジェクト" gap="var(--space-1)">
      <input
        autoFocus
        aria-label="プロジェクトを探す"
        placeholder="プロジェクト名を入力"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isImeKey(e) && list[0]) onPick(list[0].project, list[0].section);
        }}
        style={field}
      />
      <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {list.map((c) => {
          const selected = c.project === current.project && c.section === current.section;
          return (
            <PopRow
              key={`${c.project}/${c.section ?? ""}`}
              icon={c.section ? <LayoutList size={14} /> : <Hash size={14} />}
              selected={selected}
              onClick={() => onPick(c.project, c.section)}
            >
              <span style={{ flex: 1, minWidth: 0, paddingLeft: c.section ? 16 : 0, fontSize: 13, lineHeight: "19px" }}>{c.section ?? c.project}</span>
              {selected && <Check size={14} color="var(--color-accent)" aria-hidden />}
            </PopRow>
          );
        })}
      </div>
    </PopoverShell>
  );
}
