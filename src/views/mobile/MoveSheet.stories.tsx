import type { Meta, StoryObj } from "@storybook/react-vite";
import { projects, sections } from "../../mock/data";
import type { ProjectSummary } from "../../types/model";
import { BottomSheet } from "./BottomSheet";
import { SheetFrame } from "./BottomSheet.stories";
import { MoveSheet } from "./MoveSheet";

const summaries: ProjectSummary[] = projects.map((p) => ({ ...p, taskCount: 3 }));

const meta = {
  title: "Views/Mobile/MoveSheet",
  parameters: { layout: "centered" },
  render: (args) => (
    <SheetFrame>
      <BottomSheet open title="移動" onClose={args.onClose}>
        <MoveSheet {...args} />
      </BottomSheet>
    </SheetFrame>
  ),
  args: { projects: summaries, sections: sections.filter((s) => s.project === "買い物"), current: { project: "買い物", section: "今週" }, onMove: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof MoveSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "移動" };
/** 別のプロジェクトのタスク (今日 / 近日から): セクションは出さない。 */
export const OtherProject: Story = { name: "セクションなし", args: { sections: [], current: { project: "仕事", section: null } } };
