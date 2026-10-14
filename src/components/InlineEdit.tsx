import type React from "react";
import { useEffect, useRef, useState } from "react";
import { isImeKey } from "../app/keys";

export type InlineEditProps = {
  value?: string;
  placeholder?: string;
  ariaLabel: string;
  /** Enter, or leaving the field with a non-empty value. The caller decides what an unchanged value means. */
  onCommit: (value: string) => void;
  /** Esc, or leaving the field empty. */
  onCancel: () => void;
  /** Font overrides so the field matches the text it replaces (title, section header). */
  style?: React.CSSProperties;
};

/**
 * A one-line text field for renaming / naming in place. Focused and selected on mount. Enter commits and Esc cancels,
 * except while an IME composition is being confirmed (keys.ts). Esc stops propagating so only this field closes
 * (the window-level Esc layers do not see it). Commits at most once.
 */
export function InlineEdit({ value = "", placeholder, ariaLabel, onCommit, onCancel, style }: InlineEditProps) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const v = text.trim();
    if (commit && v) onCommit(v);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (isImeKey(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="outline-none border-[color:var(--color-border)] focus-visible:border-[color:var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
      style={{
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        padding: "3px 7px",
        borderRadius: "var(--radius)",
        borderWidth: 1,
        borderStyle: "solid",
        background: "transparent",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        lineHeight: "20px",
        ...style,
      }}
    />
  );
}
