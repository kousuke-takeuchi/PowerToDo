import { Bell, Check } from "lucide-react";
import { REMINDER_CODES, reminderLabel } from "../ReminderPicker";
import { SheetCard, SheetRow } from "./BottomSheet";

export type ReminderSheetProps = {
  /** 設定済みのリマインダー ("-30m" など)。 */
  value: string[];
  onChange: (reminders: string[]) => void;
};

/** リマインダーのシートの中身 (BottomSheet の children)。押すと付け外しする (シートは開いたまま)。 */
export function ReminderSheet({ value, onChange }: ReminderSheetProps) {
  const codes = [...REMINDER_CODES, ...value.filter((v) => !REMINDER_CODES.includes(v))];
  return (
    <SheetCard label="リマインダー">
      {codes.map((code) => {
        const on = value.includes(code);
        return (
          <SheetRow
            key={code}
            icon={on ? <Check size={18} /> : <Bell size={18} />}
            label={reminderLabel(code)}
            selected={on}
            onClick={() => onChange(on ? value.filter((v) => v !== code) : [...value, code])}
          />
        );
      })}
    </SheetCard>
  );
}
