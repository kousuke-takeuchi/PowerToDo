import { useState } from "react";
import { ArrowDownUp, ChevronLeft, CircleCheck, Flag, Layers, Target } from "lucide-react";
import { ALLOWED, DEFAULTS, isDefault, withSort, type Screen, type SortKey, type ViewOptions } from "../../app/view/viewOptions";
import { DATE_LABEL, GROUP_LABEL, PRIO_LABEL, SORT_LABEL } from "../ViewMenuPanel";
import { Check } from "lucide-react";
import { SheetCard, SheetRow } from "./BottomSheet";

/** The form id the sheet's red check (BottomSheet confirmForm) submits. */
export const VIEW_SHEET_FORM = "view-sheet";

export type ViewSheetProps = {
  screen: Screen;
  options: ViewOptions;
  /** The red check: the draft is saved. The 「×」 leaves it unsaved. */
  onApply: (o: ViewOptions) => void;
  onClose: () => void;
};

type Page = "root" | "group" | "sort" | "date" | "prio";

const head = { padding: "16px 4px 6px", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-secondary)" } as const;
// The date sort means nothing on Today (one day) and Upcoming (sorted inside each day).
const sortsOf = (screen: Screen): SortKey[] => (screen === "today" || screen === "upcoming" ? ["manual", "name", "time", "added", "priority"] : ["manual", "name", "date", "time", "added", "priority"]);

/**
 * The 表示 sheet of an iPhone list, in Todoist's form (spec 2026-11-28): rows of 「項目 + 今の値 + ›」 (完了したタスク is a switch); a row opens a
 * page of choices with a check on the current one, and a pick returns to the rows. Nothing is saved until the red check; the 「×」 drops
 * the changes. The same rows of the common book as the desktop's 表示 menu. The pages follow what the screen allows (`ALLOWED`).
 */
export function ViewSheet({ screen, options, onApply, onClose }: ViewSheetProps) {
  const allowed = ALLOWED[screen];
  const [draft, setDraft] = useState(options);
  const [page, setPage] = useState<Page>("root");
  const mark = (on: boolean) => (on ? <Check size={18} /> : <span style={{ width: 18 }} />);
  const pick = (next: ViewOptions) => {
    setDraft(next);
    setPage("root");
  };
  const back = (title: string) => (
    <button type="button" onClick={() => setPage("root")} style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}>
      <ChevronLeft size={18} aria-hidden />
      {title}
    </button>
  );

  if (page === "group") {
    return (
      <form id={VIEW_SHEET_FORM} onSubmit={(e) => (e.preventDefault(), onApply(draft), onClose())}>
        {back("グループ")}
        <SheetCard label="グループ">
          {allowed.groups.map((g) => (
            <SheetRow key={g} icon={mark(draft.group === g)} label={GROUP_LABEL[g]} onClick={() => pick({ ...draft, group: g })} />
          ))}
        </SheetCard>
      </form>
    );
  }
  if (page === "sort") {
    return (
      <form id={VIEW_SHEET_FORM} onSubmit={(e) => (e.preventDefault(), onApply(draft), onClose())}>
        {back("並び替え")}
        <SheetCard label="並び替え">
          {sortsOf(screen).map((s) => (
            <SheetRow key={s} icon={mark(draft.sort === s)} label={SORT_LABEL[s]} onClick={() => pick(withSort(draft, s))} />
          ))}
        </SheetCard>
      </form>
    );
  }
  if (page === "date") {
    return (
      <form id={VIEW_SHEET_FORM} onSubmit={(e) => (e.preventDefault(), onApply(draft), onClose())}>
        {back("期限")}
        <SheetCard label="期限">
          {(Object.keys(DATE_LABEL) as (keyof typeof DATE_LABEL)[]).map((d) => (
            <SheetRow key={d} icon={mark(draft.date === d)} label={DATE_LABEL[d]} onClick={() => pick({ ...draft, date: d })} />
          ))}
        </SheetCard>
      </form>
    );
  }
  if (page === "prio") {
    return (
      <form id={VIEW_SHEET_FORM} onSubmit={(e) => (e.preventDefault(), onApply(draft), onClose())}>
        {back("優先度")}
        <SheetCard label="優先度">
          {Object.keys(PRIO_LABEL).map((v) => {
            const prio = v === "all" ? "all" : (Number(v) as 1 | 2 | 3 | 4);
            return <SheetRow key={v} icon={mark(draft.prio === prio)} label={PRIO_LABEL[v]} onClick={() => pick({ ...draft, prio })} />;
          })}
        </SheetCard>
      </form>
    );
  }

  return (
    <form id={VIEW_SHEET_FORM} onSubmit={(e) => (e.preventDefault(), onApply(draft), onClose())} style={{ display: "flex", flexDirection: "column" }}>
      {allowed.done && (
        <SheetCard label="完了したタスク">
          <button
            type="button"
            role="switch"
            aria-checked={draft.done}
            onClick={() => setDraft({ ...draft, done: !draft.done })}
            style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 16px", border: 0, background: "transparent", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--color-text-primary)", textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
              <CircleCheck size={18} />
            </span>
            <span style={{ flex: 1 }}>完了したタスク</span>
            <span aria-hidden style={{ position: "relative", width: 44, height: 26, borderRadius: 13, background: draft.done ? "var(--color-accent)" : "var(--color-border)", transition: "background 120ms" }}>
              <span style={{ position: "absolute", top: 2, left: draft.done ? 20 : 2, width: 22, height: 22, borderRadius: 11, background: "#FFFFFF", transition: "left 120ms" }} />
            </span>
          </button>
        </SheetCard>
      )}
      <div style={head}>並び替え</div>
      <SheetCard label="並び替え">
        {allowed.groups.length > 1 && <SheetRow icon={<Layers size={18} />} label="グループ" value={GROUP_LABEL[draft.group]} chevron onClick={() => setPage("group")} />}
        <SheetRow icon={<ArrowDownUp size={18} />} label="並び替え" value={SORT_LABEL[draft.sort]} chevron onClick={() => setPage("sort")} />
        {draft.sort !== "manual" && <SheetRow label="並び順" value={draft.dir === "asc" ? "昇順" : "降順"} chevron onClick={() => setDraft({ ...draft, dir: draft.dir === "asc" ? "desc" : "asc" })} />}
      </SheetCard>
      <div style={head}>フィルター</div>
      <SheetCard label="フィルター">
        {allowed.filters.includes("date") && <SheetRow icon={<Target size={18} />} label="期限" value={DATE_LABEL[draft.date]} chevron onClick={() => setPage("date")} />}
        {allowed.filters.includes("prio") && <SheetRow icon={<Flag size={18} />} label="優先度" value={PRIO_LABEL[String(draft.prio)]} chevron onClick={() => setPage("prio")} />}
      </SheetCard>
      {!isDefault(draft) && (
        <div style={{ paddingTop: 16 }}>
          <SheetCard>
            <SheetRow label="リセット" onClick={() => setDraft({ ...DEFAULTS, layout: draft.layout })} />
          </SheetCard>
        </div>
      )}
    </form>
  );
}
