import { Calendar } from "lucide-react";

export type DateChipProps = { label: string; tone?: "success" | "danger" | "muted" };

const toneVar = {
  success: "var(--color-success)",
  danger: "var(--color-danger)",
  muted: "var(--color-text-muted)",
} as const;

export function DateChip({ label, tone = "success" }: DateChipProps) {
  const color = toneVar[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontFamily: "var(--font-body)",
        fontSize: 12,
        lineHeight: "17px",
        color,
      }}
    >
      <Calendar size={12} color={color} />
      {label}
    </span>
  );
}
