export type MoreChipProps = { count: number };

export function MoreChip({ count }: MoreChipProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 6px",
        borderRadius: 4,
        background: "var(--color-bg-hover)",
        fontFamily: "var(--font-body)",
        fontSize: 12,
        lineHeight: "17px",
        color: "var(--color-text-secondary)",
      }}
    >
      +{count}
    </span>
  );
}
