/** Spec ④ iPhone §3.1-3.2: four tabs, and inside 閲覧 a stack of screens (project, labels, label, search, settings). Pure. */
export type MobileTab = "inbox" | "today" | "upcoming" | "browse";
export type BrowseScreen =
  | { kind: "project"; name: string }
  | { kind: "labels" }
  | { kind: "label"; name: string }
  | { kind: "search" }
  | { kind: "settings" };
export type MobileNav = { tab: MobileTab; browse: BrowseScreen[] };
export type NavAction =
  | { type: "tab"; tab: MobileTab }
  | { type: "push"; screen: BrowseScreen }
  | { type: "back" }
  | { type: "renamed"; from: string; to: string }
  | { type: "removed"; project: string };
export type Screen = { kind: "inbox" } | { kind: "today" } | { kind: "upcoming" } | { kind: "browse" } | BrowseScreen;

export const INITIAL_NAV: MobileNav = { tab: "inbox", browse: [] };

export function reduceNav(s: MobileNav, a: NavAction): MobileNav {
  switch (a.type) {
    case "tab":
      // Tapping 閲覧 again goes back to its root (iOS). Other tabs keep the 閲覧 stack for when the user comes back.
      if (a.tab === "browse" && s.tab === "browse") return { tab: "browse", browse: [] };
      return { ...s, tab: a.tab };
    case "push":
      return { tab: "browse", browse: [...(s.tab === "browse" ? s.browse : []), a.screen] };
    case "back":
      return { ...s, browse: s.browse.slice(0, -1) };
    case "renamed":
      return { ...s, browse: s.browse.map((x) => (x.kind === "project" && x.name === a.from ? { kind: "project", name: a.to } : x)) };
    case "removed": {
      const i = s.browse.findIndex((x) => x.kind === "project" && x.name === a.project);
      return i < 0 ? s : { ...s, browse: s.browse.slice(0, i) };
    }
  }
}

export function screenOf(s: MobileNav): Screen {
  if (s.tab !== "browse") return { kind: s.tab };
  return s.browse[s.browse.length - 1] ?? { kind: "browse" };
}

/** The source of the cross views (`useCrossViews`' nav, the Sidebar `active` shape). Screens without one read the inbox. */
export function crossNavOf(s: MobileNav): { kind: "inbox" | "today" | "upcoming" | "labels" | "project" | "label"; name?: string } {
  const sc = screenOf(s);
  switch (sc.kind) {
    case "today":
    case "upcoming":
    case "labels":
      return { kind: sc.kind };
    case "project":
    case "label":
      return { kind: sc.kind, name: sc.name };
    default:
      return { kind: "inbox" };
  }
}

/** The project the list shows and quick add adds to: the open project, else the inbox. */
export function projectOf(s: MobileNav, inbox: string): string {
  const sc = screenOf(s);
  return sc.kind === "project" ? sc.name : inbox;
}
