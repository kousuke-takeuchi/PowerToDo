import type React from "react";

export type TextFieldProps = {
  value?: string;
  placeholder?: string;
  onChange?: (v: string) => void;
  type?: "text" | "password" | "url";
  readOnly?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  /** 文字の大きさ (px、既定 14)。iOS は 16 未満の入力欄にフォーカスすると拡大するので、モバイルのシートでは 16。 */
  fontSize?: number;
};

export function TextField({ value, placeholder, onChange, type = "text", readOnly, ariaLabel, autoFocus, onKeyDown, onCompositionStart, onCompositionEnd, fontSize = 14 }: TextFieldProps) {
  return (
    <input
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      className="outline-none border-[color:var(--color-border)] focus-visible:border-[color:var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
      style={{
        boxSizing: "border-box",
        width: "100%",
        padding: "7px 11px",
        borderRadius: "var(--radius)",
        borderWidth: 1,
        borderStyle: "solid",
        background: "transparent",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
        fontSize,
        lineHeight: "20px",
      }}
    />
  );
}
