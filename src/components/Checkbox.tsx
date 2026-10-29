import { useEffect, useRef } from "react";
import { motion, useAnimate } from "motion/react";
import { EASE_CSS, useMotionTiming } from "../motion";

export type CheckboxProps = {
  checked: boolean;
  priority?: 1 | 2 | 3 | 4;
  onChange?: (checked: boolean) => void;
  /** 18 on desktop (Todoist), 22 on iPhone. 20 is kept only for DesktopTaskRow's mobile branch; iPhone screens do not use it. */
  size?: 18 | 20 | 22;
  ariaLabel?: string;
};

const priorityVar = {
  1: "var(--color-priority-1)",
  2: "var(--color-priority-2)",
  3: "var(--color-priority-3)",
  4: "var(--color-priority-4)",
} as const;

/**
 * 完了すると、リングが 1 -> 1.25 -> 1 に膨らみ (200ms)、内側が success で塗られ (150ms)、チェックが描かれる (200ms)。
 * 戻すときは 120ms で逆再生。最初の描画ではアニメーションしない。prefers-reduced-motion では即時。
 */
export function Checkbox({ checked, priority = 4, onChange, size = 18, ariaLabel }: CheckboxProps) {
  const { reduced, t } = useMotionTiming();
  const desktop = size === 18;
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const prev = useRef(checked);
  useEffect(() => {
    if (prev.current === checked) return;
    prev.current = checked;
    if (checked && !reduced && scope.current) {
      animate(scope.current, { scale: [1, 1.25, 1] }, t(0.2));
    }
  }, [checked, reduced, animate, scope]);

  // Todoist: a 2 px ring and, for priority 1-3, a 10 % fill of its color.
  const ring = 2;
  const tint = !checked && priority < 4;
  const color = checked ? "var(--color-success)" : priorityVar[priority];
  const fadeIn = t(checked ? 0.15 : 0.12);
  const draw = t(checked ? 0.2 : 0.12);
  return (
    <button
      ref={scope}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange?.(!checked)}
      className={desktop ? "group/check" : undefined}
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `${ring}px solid ${color}`,
        background: tint ? `color-mix(in srgb, ${priorityVar[priority]} 10%, transparent)` : "transparent",
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: "pointer",
        flex: "0 0 auto",
        boxSizing: "border-box",
        transition: reduced ? undefined : `border-color ${checked ? 150 : 120}ms ${EASE_CSS}`,
      }}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ opacity: checked ? 1 : 0 }}
        transition={fadeIn}
        style={{ position: "absolute", inset: 0, borderRadius: size / 2, background: "var(--color-success)" }}
      />
      {desktop && !checked && (
        // Hover preview of the check (Todoist): shown at once, no transition.
        <svg
          aria-hidden
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 12 12"
          fill="none"
          className="opacity-0 group-hover/check:opacity-100"
          style={{ position: "absolute", display: "block" }}
        >
          <path d="M2.5 6.5 L5 9 L9.5 3.5" stroke="var(--color-text-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <svg
        aria-hidden
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 12 12"
        fill="none"
        style={{ position: "relative", display: "block", flex: "0 0 auto" }}
      >
        <motion.path
          d="M2.5 6.5 L5 9 L9.5 3.5"
          stroke="#FFFFFF" /* success 緑の上の白 (他の「アクセント上の白」と同じ固定値) */
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={draw}
        />
      </svg>
    </button>
  );
}
