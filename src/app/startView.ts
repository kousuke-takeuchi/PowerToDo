import type { StartView } from "../types/model";
import type { MobileNav } from "./mobileNav";

/** Spec ② §8: the screen to open at launch. Anything but "inbox" (also a missing value) means Today. */
export function startKind(v: StartView | undefined): "today" | "inbox" {
  return v === "inbox" ? "inbox" : "today";
}

/** The desktop's first nav. */
export function initialNav(v: StartView | undefined): { kind: "today" | "inbox" } {
  return { kind: startKind(v) };
}

/** The iPhone's first tab state. */
export function initialMobileNav(v: StartView | undefined): MobileNav {
  return { tab: startKind(v), browse: [] };
}
