import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScreenStack } from "./ScreenStack";
import { directionBetween, type ScreenDirection } from "./screenMotion";

const meta = { title: "Views/Mobile/ScreenStack", parameters: { layout: "fullscreen" }, globals: { viewport: { value: "mobile", isRotated: false } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const button = { height: 44, padding: "0 16px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-bg)", fontFamily: "var(--font-body)", fontSize: 16, cursor: "pointer" } as const;

/** Push, back and tab changes between three screens (spec 2026-11-28): the screen slides or fades instead of switching at once. */
function Demo() {
  const [nav, setNav] = useState({ tab: "today", browse: [] as string[] });
  const prev = useRef(nav);
  const dir = useRef<ScreenDirection>("none");
  if (prev.current !== nav) {
    dir.current = directionBetween(prev.current, nav);
    prev.current = nav;
  }
  const key = `${nav.tab}:${nav.browse.join("/")}`;
  return (
    <ScreenStack screenKey={key} direction={dir.current}>
      <div style={{ height: "100%", padding: "80px 20px", display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--font-body)", background: "var(--color-bg)" }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>{nav.browse.length ? `画面 ${nav.browse.length}` : nav.tab === "today" ? "今日" : "閲覧"}</h1>
        <button type="button" style={button} onClick={() => setNav({ ...nav, browse: [...nav.browse, String(nav.browse.length + 1)] })}>
          進む
        </button>
        <button type="button" style={button} disabled={nav.browse.length === 0} onClick={() => setNav({ ...nav, browse: nav.browse.slice(0, -1) })}>
          戻る
        </button>
        <button type="button" style={button} onClick={() => setNav({ tab: nav.tab === "today" ? "browse" : "today", browse: [] })}>
          タブを切り替える
        </button>
      </div>
    </ScreenStack>
  );
}

export const Navigation: Story = { name: "画面の移り方", render: () => <Demo /> };
