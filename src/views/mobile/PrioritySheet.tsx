import { Check, Flag } from "lucide-react";
import { SheetRow } from "./BottomSheet";

export type PrioritySheetProps = {
  value: 1 | 2 | 3 | 4;
  onChange: (p: 1 | 2 | 3 | 4) => void;
  onClose: () => void;
};

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: "P1 (高)" },
  { value: 2, label: "P2 (中)" },
  { value: 3, label: "P3 (低)" },
  { value: 4, label: "P4 (なし)" },
];

/** 優先度のシートの中身 (BottomSheet の children)。選ぶと onChange して onClose (今と同じ値なら onClose だけ)。 */
export function PrioritySheet({ value, onChange, onClose }: PrioritySheetProps) {
  return (
    <div role="group" aria-label="優先度" style={{ display: "flex", flexDirection: "column" }}>
      {PRIORITIES.map((p) => (
        <SheetRow
          key={p.value}
          icon={value === p.value ? <Check size={18} /> : <Flag size={18} />}
          iconColor={`var(--color-priority-${p.value})`}
          label={p.label}
          selected={value === p.value}
          onClick={() => {
            if (p.value !== value) onChange(p.value);
            onClose();
          }}
        />
      ))}
    </div>
  );
}
