export type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange?: (v: T) => void;
  /** スクリーンリーダー向けのグループ名。 */
  ariaLabel?: string;
  /** 全部の選択肢を押せなくする (Tab でも止まらない)。 */
  disabled?: boolean;
};

export function Segmented<T extends string>({ options, value, onChange, ariaLabel, disabled }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      style={{
        display: "flex",
        width: "100%",
        padding: 2,
        borderRadius: 8,
        background: "var(--color-bg-hover)",
        boxSizing: "border-box",
        ...(disabled ? { opacity: 0.5 } : {}),
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            onClick={() => onChange?.(o.value)}
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              border: "none",
              background: selected ? "var(--color-bg)" : "transparent",
              color: selected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontFamily: "var(--font-body)",
              fontSize: 13,
              lineHeight: "19px",
              fontWeight: selected ? 600 : 400,
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
