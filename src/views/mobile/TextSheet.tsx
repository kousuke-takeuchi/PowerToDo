import { useState } from "react";
import { SheetCard } from "./BottomSheet";

/** The form id the sheet's red check (BottomSheet confirmForm) submits. */
export const TEXT_SHEET_FORM = "text-sheet";

export type TextSheetProps = {
  label: string;
  value: string;
  /** Several lines (note). Omitted: one line (name). */
  multiline?: boolean;
  placeholder?: string;
  /** Save (the caller decides whether empty is allowed). Calls onClose after saving. */
  onSave: (text: string) => void;
  onClose: () => void;
  formId?: string;
};

/** Sheet body for a name / note / subtask name (BottomSheet children). 16 px text (iOS does not zoom). The x cancels and the check saves. */
export function TextSheet({ label, value, multiline, placeholder, onSave, onClose, formId = TEXT_SHEET_FORM }: TextSheetProps) {
  const [draft, setDraft] = useState(value);
  const save = () => {
    if (draft !== value) onSave(draft);
    onClose();
  };
  const style = {
    boxSizing: "border-box",
    width: "100%",
    padding: "12px 16px",
    border: 0,
    outline: "none",
    background: "transparent",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    lineHeight: "24px",
    color: "var(--color-text-primary)",
  } as const;
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <SheetCard>
        {multiline ? (
          <textarea aria-label={label} value={draft} placeholder={placeholder} autoFocus rows={5} onChange={(e) => setDraft(e.target.value)} style={{ ...style, resize: "none" }} />
        ) : (
          <input
            aria-label={label}
            value={draft}
            placeholder={placeholder}
            autoFocus
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault(); // no implicit form submit: the Enter that confirms IME conversion must not save
              if (!e.nativeEvent.isComposing && e.keyCode !== 229) save();
            }}
            style={style}
          />
        )}
      </SheetCard>
    </form>
  );
}
