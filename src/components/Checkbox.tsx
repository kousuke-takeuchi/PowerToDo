export type CheckboxProps = {
  checked: boolean;
  priority?: 1 | 2 | 3 | 4;
  onChange?: (checked: boolean) => void;
  size?: 20;
};

const priorityVar = {
  1: "var(--color-priority-1)",
  2: "var(--color-priority-2)",
  3: "var(--color-priority-3)",
  4: "var(--color-priority-4)",
} as const;

export function Checkbox({ checked, priority = 4, onChange, size = 20 }: CheckboxProps) {
  const color = checked ? "var(--color-success)" : priorityVar[priority];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `1.5px solid ${color}`,
        background: "transparent",
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: "pointer",
        flex: "0 0 auto",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{ width: 10, height: 10, borderRadius: 5, background: color, opacity: checked ? 1 : 0 }}
      />
    </button>
  );
}
