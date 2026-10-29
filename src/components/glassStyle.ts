import type { CSSProperties } from "react";

/** Spec ④ iPhone §3.6: the blur behind the floating bars and round buttons. */
export const GLASS_BLUR = 20;

type Supports = { supports(property: string, value: string): boolean };

/** Whether the WebView can blur what is behind an element (WKWebView knows only the -webkit- spelling on older iOS). */
export function backdropSupported(css: Supports | undefined): boolean {
  if (!css) return false;
  const v = `blur(${GLASS_BLUR}px)`;
  return css.supports("backdrop-filter", v) || css.supports("-webkit-backdrop-filter", v);
}

/** Translucent ground + blur + a thin light edge; without backdrop-filter an opaque ground (spec ④ iPhone §3.6). */
export function glassStyle(supported: boolean): CSSProperties {
  const edge = "inset 0 0 0 0.5px var(--color-glass-edge), var(--shadow-glass)";
  if (!supported) return { background: "var(--color-glass-solid)", boxShadow: edge };
  const filter = `blur(${GLASS_BLUR}px) saturate(180%)`;
  return { background: "var(--color-glass)", backdropFilter: filter, WebkitBackdropFilter: filter, boxShadow: edge };
}
