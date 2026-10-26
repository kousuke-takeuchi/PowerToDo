import type React from "react";
import { backdropSupported, glassStyle } from "./glass";

const SUPPORTED = typeof CSS !== "undefined" && backdropSupported(CSS);

export type GlassProps = React.HTMLAttributes<HTMLDivElement> & { radius: number };

/** iOS 26 "glass" (spec ④ iPhone §3.6): the tab bar, the top bar's right buttons, the sheets' ×. */
export function Glass({ radius, style, children, ...rest }: GlassProps) {
  return (
    <div {...rest} style={{ borderRadius: radius, ...glassStyle(SUPPORTED), ...style }}>
      {children}
    </div>
  );
}
