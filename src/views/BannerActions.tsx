import type React from "react";
import { useContext } from "react";
import { NarrowContext } from "../components/NarrowContext";

/** 帯のボタン群。縦長の幅 (NarrowContext) では帯の次の行に縦に並べて全幅にし、デスクトップでは何も足さない (子をそのまま並べる)。 */
export function BannerActions({ children }: { children: React.ReactNode }) {
  const narrow = useContext(NarrowContext);
  if (!narrow) return <>{children}</>;
  return <div style={{ flex: "1 1 100%", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>{children}</div>;
}

/** 帯のルートに足すスタイル: 縦長の幅では左右の余白を 16、ボタンを次の行に折り返す。 */
export function bandNarrow(narrow: boolean): React.CSSProperties {
  return narrow ? { padding: "10px 16px", flexWrap: "wrap" } : {};
}
