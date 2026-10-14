import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SearchDialog } from "./SearchDialog";
import { TODAY, tasks } from "../mock/data";
import type { SearchHit } from "../types/model";

const pick = (no: number) => tasks.find((t) => t.no === no)!;
const hits: SearchHit[] = [
  { task: pick(1), matched: "title" },
  { task: pick(3), matched: "note" },
  { task: pick(8), matched: "label" },
];

const meta = {
  title: "Views/SearchDialog",
  component: SearchDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    query: "食",
    onChangeQuery: fn(),
    includeDone: false,
    onToggleIncludeDone: fn(),
    hits,
    selected: 1,
    onSelect: fn(),
    onOpen: fn(),
    onToggleDone: fn(),
    onClose: fn(),
    today: TODAY,
  },
  // overlay スロットと同じ「親いっぱい + 絶対配置」の入れ物
  decorators: [
    (Story) => (
      <div style={{ position: "relative", width: "100%", height: 600, background: "var(--color-bg)" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof SearchDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Results: Story = {};
export const Empty: Story = { args: { query: "", hits: [] } };
export const NoMatch: Story = { args: { query: "ほげ", hits: [] } };

/** ↑↓ で選択が動き、Enter で onOpen (Actions パネルに出る)。 */
export const Interactive: Story = {
  render: (args) => {
    const [sel, setSel] = useState(0);
    const [q, setQ] = useState("食");
    const [all, setAll] = useState(false);
    return (
      <SearchDialog
        {...args}
        query={q}
        onChangeQuery={setQ}
        includeDone={all}
        onToggleIncludeDone={() => setAll((v) => !v)}
        selected={sel}
        onSelect={setSel}
      />
    );
  },
};
