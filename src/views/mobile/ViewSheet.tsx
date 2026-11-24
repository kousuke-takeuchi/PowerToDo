import { Check } from "lucide-react";
import { ALLOWED, DEFAULTS, isDefault, withSort, type Screen, type SortKey, type ViewOptions } from "../../app/view/viewOptions";
import { GROUP_LABEL, PRIO_LABEL, SORT_LABEL } from "../ViewMenuPanel";
import { SheetCard, SheetRow } from "./BottomSheet";

export type ViewSheetProps = {
  screen: Extract<Screen, "today" | "upcoming">;
  options: ViewOptions;
  onChange: (o: ViewOptions) => void;
};

const head = { padding: "8px 4px 4px", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-secondary)" } as const;
// The date sort is a no-op here: Today is one day and Upcoming is sorted inside each day.
const SORTS: SortKey[] = ["manual", "name", "time", "added", "priority"];

/**
 * Spec 2026-11-24: the 表示 sheet of Today / Upcoming (the iPhone's version of the desktop's 表示 menu): sort, direction,
 * group (Today only) and the priority filter. The same rows of the common book as the desktop, so the choice follows to every device.
 * A pick keeps the sheet open (like the label sheet).
 */
export function ViewSheet({ screen, options, onChange }: ViewSheetProps) {
  const allowed = ALLOWED[screen];
  const mark = (on: boolean) => (on ? <Check size={18} /> : <span style={{ width: 18 }} />);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={head}>並び替え</div>
      <SheetCard label="並び替え">
        {SORTS.map((s) => (
          <SheetRow key={s} icon={mark(options.sort === s)} label={SORT_LABEL[s]} selected={options.sort === s} onClick={() => onChange(withSort(options, s))} />
        ))}
      </SheetCard>
      {options.sort !== "manual" && (
        <>
          <div style={head}>並び順</div>
          <SheetCard label="並び順">
            <SheetRow icon={mark(options.dir === "asc")} label="昇順" selected={options.dir === "asc"} onClick={() => onChange({ ...options, dir: "asc" })} />
            <SheetRow icon={mark(options.dir === "desc")} label="降順" selected={options.dir === "desc"} onClick={() => onChange({ ...options, dir: "desc" })} />
          </SheetCard>
        </>
      )}
      {allowed.groups.length > 1 && (
        <>
          <div style={head}>グループ</div>
          <SheetCard label="グループ">
            {allowed.groups.map((g) => (
              <SheetRow key={g} icon={mark(options.group === g)} label={GROUP_LABEL[g]} selected={options.group === g} onClick={() => onChange({ ...options, group: g })} />
            ))}
          </SheetCard>
        </>
      )}
      <div style={head}>優先度で絞り込む</div>
      <SheetCard label="優先度">
        {Object.keys(PRIO_LABEL).map((v) => {
          const prio = v === "all" ? "all" : (Number(v) as 1 | 2 | 3 | 4);
          return <SheetRow key={v} icon={mark(options.prio === prio)} label={PRIO_LABEL[v]} selected={options.prio === prio} onClick={() => onChange({ ...options, prio })} />;
        })}
      </SheetCard>
      {!isDefault(options) && (
        <div style={{ paddingTop: 12 }}>
          <SheetCard>
            <SheetRow label="リセット" onClick={() => onChange(DEFAULTS)} />
          </SheetCard>
        </div>
      )}
    </div>
  );
}
