import type React from "react";

export type ButtonProps = {
  variant?: "primary" | "secondary" | "icon";
  children?: React.ReactNode;
  icon?: React.ComponentType<{ size?: number }>;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
};

export function Button({
  variant = "primary",
  children,
  icon: Icon,
  onClick,
  disabled,
  type = "button",
  ariaLabel,
}: ButtonProps) {
  if (variant === "icon") {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          border: "none",
          display: "grid",
          placeItems: "center",
          padding: 0,
          color: "var(--color-text-secondary)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          flex: "0 0 auto",
        }}
      >
        {Icon ? <Icon size={18} /> : children}
      </button>
    );
  }
  const primary = variant === "primary";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        padding: "8px 16px",
        borderRadius: "var(--radius)",
        border: "none",
        background: primary ? "var(--color-accent)" : "var(--color-bg-hover)",
        color: primary ? "#FFFFFF" : "var(--color-text-primary)",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        lineHeight: "20px",
        fontWeight: primary ? 600 : 400,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flex: "0 0 auto",
      }}
    >
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}
