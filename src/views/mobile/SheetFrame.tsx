import type React from "react";

/** シートを重ねる 390x560 の枠 (実画面では MobileShell の overlay)。 */
export function SheetFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", width: 390, height: 560, overflow: "hidden", background: "var(--color-bg-hover)", fontFamily: "var(--font-body)" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>{children}</div>
    </div>
  );
}
