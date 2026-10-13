export type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange?: (v: T) => void;
};

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        width: "100%",
        padding: 2,
        borderRadius: 8,
        background: "var(--color-bg-hover)",
        boxSizing: "border-box",
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
              lineHeight: "18px",
              fontWeight: selected ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
