import type { Meta, StoryObj } from "@storybook/react-vite";

const names = ["bg","bg-sidebar","bg-hover","text-primary","text-secondary","text-muted","border","accent","accent-soft","priority-1","priority-2","priority-3","priority-4","success","danger"];

function Tokens() {
  return (
    <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
      {names.map((n) => (
        <div key={n} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: 8 }}>
          <div style={{ height: 40, background: `var(--color-${n})`, borderRadius: 4 }} />
          <div style={{ fontSize: 12, marginTop: 4 }}>{n}</div>
        </div>
      ))}
    </div>
  );
}

const meta: Meta<typeof Tokens> = { title: "Foundation/Tokens", component: Tokens };
export default meta;
export const All: StoryObj<typeof Tokens> = {};
