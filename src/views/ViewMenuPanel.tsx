import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Kanban, List } from "lucide-react";
import { ALLOWED, DEFAULTS, isDefault, withSort, type CreatedFilter, type DateFilter, type GroupKey, type Screen, type SortKey, type ViewOptions } from "../app/view/viewOptions";
import { PopRow, PopoverShell } from "./PopoverShell";

const GROUP_LABEL: Record<GroupKey, string> = { none: "なし", date: "日付", added: "追加日", priority: "優先度", label: "ラベル", project: "プロジェクト" };
const SORT_LABEL: Record<SortKey, string> = { manual: "手動", name: "名前", date: "日付", added: "追加日", priority: "優先度" };
const DATE_LABEL: Record<DateFilter, string> = { all: "すべて", today: "今日", week: "今週", "7d": "次の 7 日間", month: "今月", "30d": "次の 30 日間", none: "日付なし" };
const CREATED_LABEL: Record<CreatedFilter, string> = { all: "すべて", today: "今日", "7d": "過去 7 日間", "30d": "過去 30 日間" };
const PRIO_LABEL: Record<string, string> = { all: "すべて", "1": "P1", "2": "P2", "3": "P3", "4": "P4" };

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 32 };
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-muted)" };
const labelStyle: React.CSSProperties = { fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" };

/** A 140-wide button that opens a list of choices under it, with ✓ on the current one. */
function Select<T extends string>({ label, value, options, changed, onPick }: { label: string; value: T; options: { value: T; text: string }[]; changed: boolean; onPick: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const current = options.find((o) => o.value === value)?.text ?? "";
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <div ref={ref} style={{ position: "relative", width: 140 }}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="bg-transparent hover:bg-[var(--color-bg-hover)]"
          style={{
            width: 140,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 8px",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            fontFamily: "var(--font-body)",
            fontSize: 13,
            lineHeight: "19px",
            color: changed ? "var(--color-accent)" : "var(--color-text-primary)",
            cursor: "pointer",
          }}
        >
          {current}
          <ChevronDown size={14} aria-hidden />
        </button>
        {open && (
          <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 20, marginTop: 4 }}>
            <PopoverShell label={label} width={140} gap="2px">
              {options.map((o) => (
                <PopRow
                  key={o.value}
                  selected={o.value === value}
                  onClick={() => {
                    setOpen(false);
                    onPick(o.value);
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, lineHeight: "19px" }}>{o.text}</span>
                  {o.value === value && <Check size={14} aria-label="✓" />}
                </PopRow>
              ))}
            </PopoverShell>
          </div>
        )}
      </div>
    </div>
  );
}

/** A heading that folds its rows (spec §2.1 たためる見出し), open at first; the chevron as in the other collapsible headings. */
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <h3 style={headingStyle}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="bg-transparent"
          style={{ display: "flex", alignItems: "center", gap: 4, padding: 0, border: 0, font: "inherit", color: "inherit", cursor: "pointer" }}
        >
          {title}
          <span aria-hidden style={{ display: "inline-flex" }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
      </h3>
      {open && children}
    </>
  );
}

function LayoutButton({ icon: Icon, text, active, onClick }: { icon: React.ComponentType<{ size?: number }>; text: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={active ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "8px 0",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: 8,
        background: active ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
        fontSize: 12,
        lineHeight: "18px",
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      <Icon size={18} />
      {text}
    </button>
  );
}

/** The 表示 menu body (spec §2.1): layout, done, sort and group, filters, reset. Only what the screen allows. */
export function ViewMenuPanel({ screen, options, onChange }: { screen: Screen; options: ViewOptions; onChange: (o: ViewOptions) => void }) {
  const allowed = ALLOWED[screen];
  const set = (patch: Partial<ViewOptions>) => onChange({ ...options, ...patch });
  const groupOptions = allowed.groups.map((g) => ({ value: g, text: GROUP_LABEL[g] }));
  const sortOptions = (Object.keys(SORT_LABEL) as SortKey[]).map((s) => ({ value: s, text: SORT_LABEL[s] }));
  const dateOptions = (Object.keys(DATE_LABEL) as DateFilter[]).map((v) => ({ value: v, text: DATE_LABEL[v] }));
  const createdOptions = (Object.keys(CREATED_LABEL) as CreatedFilter[]).map((v) => ({ value: v, text: CREATED_LABEL[v] }));
  const prioOptions = Object.keys(PRIO_LABEL).map((v) => ({ value: v, text: PRIO_LABEL[v] }));
  // The board has no groups (spec ⑤ §4).
  const showGroup = allowed.groups.length > 1 && options.layout !== "board";
  return (
    <div style={{ width: 260, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8, padding: 12, fontFamily: "var(--font-body)" }}>
      {allowed.layout && (
        <>
          <h3 style={headingStyle}>レイアウト</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <LayoutButton icon={List} text="リスト" active={options.layout === "list"} onClick={() => set({ layout: "list" })} />
            <LayoutButton icon={Kanban} text="ボード" active={options.layout === "board"} onClick={() => set({ layout: "board" })} />
          </div>
        </>
      )}
      {allowed.done && (
        <div style={rowStyle}>
          <span style={{ ...labelStyle, color: options.done ? "var(--color-accent)" : labelStyle.color }}>完了したタスク</span>
          <button
            type="button"
            role="switch"
            aria-checked={options.done}
            aria-label="完了したタスク"
            onClick={() => set({ done: !options.done })}
            style={{ position: "relative", width: 32, height: 18, border: 0, borderRadius: 9, background: options.done ? "var(--color-accent)" : "var(--color-border)", cursor: "pointer", padding: 0 }}
          >
            <span style={{ position: "absolute", top: 2, left: options.done ? 16 : 2, width: 14, height: 14, borderRadius: 7, background: "var(--color-bg)", transition: "left 120ms" }} />
          </button>
        </div>
      )}
      <Fold title="並び替え">
        {showGroup && <Select label="グループ" value={options.group} options={groupOptions} changed={options.group !== DEFAULTS.group} onPick={(group) => set({ group })} />}
        <Select label="並び替え" value={options.sort} options={sortOptions} changed={options.sort !== DEFAULTS.sort} onPick={(sort) => onChange(withSort(options, sort))} />
        {options.sort !== "manual" && (
          <Select
            label="並び順"
            value={options.dir}
            options={[
              { value: "asc", text: "昇順" },
              { value: "desc", text: "降順" },
            ]}
            changed={options.dir !== withSort(options, options.sort).dir}
            onPick={(dir) => set({ dir })}
          />
        )}
      </Fold>
      <Fold title="フィルター">
        {allowed.filters.includes("date") && <Select label="日付" value={options.date} options={dateOptions} changed={options.date !== DEFAULTS.date} onPick={(date) => set({ date })} />}
        {allowed.filters.includes("created") && <Select label="作成日" value={options.created} options={createdOptions} changed={options.created !== DEFAULTS.created} onPick={(created) => set({ created })} />}
        {allowed.filters.includes("prio") && (
          <Select
            label="優先度"
            value={String(options.prio)}
            options={prioOptions}
            changed={options.prio !== DEFAULTS.prio}
            onPick={(v) => set({ prio: v === "all" ? "all" : (Number(v) as 1 | 2 | 3 | 4) })}
          />
        )}
      </Fold>
      {!isDefault(options) && (
        <button
          type="button"
          onClick={() => onChange(DEFAULTS)}
          className="bg-transparent hover:bg-[var(--color-bg-hover)]"
          style={{ alignSelf: "stretch", padding: "6px 8px", border: 0, borderTop: "1px solid var(--color-border)", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-accent)", textAlign: "left", cursor: "pointer" }}
        >
          リセット
        </button>
      )}
    </div>
  );
}
