import { Flag } from "lucide-react";

export type PriorityChipProps = { priority: 1 | 2 | 3 | 4 };

export function PriorityChip({ priority }: PriorityChipProps) {
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
      <Flag size={12} color={`var(--color-priority-${priority})`} />
      P{priority}
    </span>
  );
}
