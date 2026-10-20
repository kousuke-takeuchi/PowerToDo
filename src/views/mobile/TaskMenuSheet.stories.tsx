import type { Meta, StoryObj } from "@storybook/react-vite";
import { tasks } from "../../mock/data";
import { BottomSheet } from "./BottomSheet";
import { SheetFrame } from "./BottomSheet.stories";
import { TaskMenuSheet } from "./TaskMenuSheet";

const meta = {
  title: "Views/Mobile/TaskMenuSheet",
  parameters: { layout: "centered" },
  render: (args) => (
    <SheetFrame>
      <BottomSheet open title={args.task.title} onClose={args.onClose}>
        <TaskMenuSheet {...args} />
      </BottomSheet>
    </SheetFrame>
  ),
  args: { task: tasks[0], onDate: () => undefined, onPriority: () => undefined, onMove: () => undefined, onDelete: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof TaskMenuSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "メニュー" };
export const Subtask: Story = { name: "サブタスク (移動なし)", args: { task: tasks[4], onMove: undefined } };
