export type TextFieldProps = {
  value?: string;
  placeholder?: string;
  onChange?: (v: string) => void;
  type?: "text" | "password" | "url";
  readOnly?: boolean;
};

export function TextField({ value, placeholder, onChange, type = "text", readOnly }: TextFieldProps) {
  return (
    <input
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
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
        fontSize: 14,
        lineHeight: "20px",
      }}
    />
  );
}
