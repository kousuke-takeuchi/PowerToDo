import { useState } from "react";
import { Button } from "../../components/Button";

export type TextSheetProps = {
  label: string;
  value: string;
  /** 複数行 (メモ)。省略すると 1 行 (名前)。 */
  multiline?: boolean;
  placeholder?: string;
  /** 保存 (空にしてよいかは呼び出し側が決める)。保存したら onClose を呼ぶ。 */
  onSave: (text: string) => void;
  onClose: () => void;
};

/** 名前 / メモ / サブタスク名を入力するシートの中身 (BottomSheet の children)。文字は 16px (iOS が拡大しない)。 */
export function TextSheet({ label, value, multiline, placeholder, onSave, onClose }: TextSheetProps) {
  const [draft, setDraft] = useState(value);
  const save = () => {
    if (draft !== value) onSave(draft);
    onClose();
  };
  const style = {
    boxSizing: "border-box",
    width: "100%",
    padding: "8px 12px",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    outline: "none",
    background: "var(--color-bg)",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    lineHeight: "24px",
    color: "var(--color-text-primary)",
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
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
            // 変換を確定する Enter では保存しない
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) save();
          }}
          style={style}
        />
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={save}>保存</Button>
      </div>
    </div>
  );
}
