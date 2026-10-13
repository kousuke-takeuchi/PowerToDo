import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProjectItem } from "./ProjectItem";

const meta = {
  title: "Components/ProjectItem",
  component: ProjectItem,
  decorators: [(Story) => <div style={{ width: 248, padding: 24 }}><Story /></div>],
} satisfies Meta<typeof ProjectItem>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { color: "var(--color-priority-3)", label: "仕事" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <ProjectItem color="var(--color-priority-3)" label="仕事" count={8} />
      <ProjectItem color="var(--color-success)" label="家事" count={3} active />
      <ProjectItem color="var(--color-priority-2)" label="買い物" />
    </div>
  ),
};

export const Playground: Story = {
  args: { color: "var(--color-priority-3)", label: "仕事", count: 8, active: false },
};
