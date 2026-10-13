import { Tag } from "lucide-react";

export type LabelChipProps = { name: string };

export function LabelChip({ name }: LabelChipProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "2px 6px",
        borderRadius: 4,
        fontFamily: "var(--font-body)",
        fontSize: 12,
        lineHeight: "17px",
        color: "var(--color-text-secondary)",
      }}
    >
      <Tag size={12} color="var(--color-text-muted)" />@{name}
    </span>
  );
}
