import { Check, Tag } from "lucide-react";
import type { Label } from "../../types/model";
import { SheetCard, SheetRow } from "./BottomSheet";

export type LabelSheetProps = {
  /** 選べるラベル (ストアにあるもの)。 */
  labels: Label[];
  /** 付いているラベル名。 */
  value: string[];
  onChange: (labels: string[]) => void;
};

/** ラベルのシートの中身 (BottomSheet の children)。押すと付け外しする (シートは開いたまま)。 */
export function LabelSheet({ labels, value, onChange }: LabelSheetProps) {
  // ストアに無いラベルが付いていても外せるように、並べる
  const extra = value.filter((v) => !labels.some((l) => l.name === v)).map((name) => ({ name, color: "var(--color-text-secondary)", order: 0 }));
  const all = [...labels, ...extra];
  if (all.length === 0) {
    return <div style={{ padding: "var(--space-3) 4px", fontSize: 14, color: "var(--color-text-secondary)" }}>ラベルがありません</div>;
  }
  return (
    <SheetCard label="ラベル">
      {all.map((l) => {
        const on = value.includes(l.name);
        return (
          <SheetRow
            key={l.name}
            icon={on ? <Check size={18} /> : <Tag size={18} />}
            iconColor={l.color}
            label={`@${l.name}`}
            selected={on}
            onClick={() => onChange(on ? value.filter((v) => v !== l.name) : [...value, l.name])}
          />
        );
      })}
    </SheetCard>
  );
}
