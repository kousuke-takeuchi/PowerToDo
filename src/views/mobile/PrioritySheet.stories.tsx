import type { Meta, StoryObj } from "@storybook/react-vite";
import { BottomSheet } from "./BottomSheet";
import { SheetFrame } from "./SheetFrame";
import { PrioritySheet } from "./PrioritySheet";

const meta = {
  title: "Views/Mobile/PrioritySheet",
  parameters: { layout: "centered" },
  render: (args) => (
    <SheetFrame>
      <BottomSheet open title="優先度" onClose={args.onClose}>
        <PrioritySheet {...args} />
      </BottomSheet>
    </SheetFrame>
  ),
  args: { value: 2, onChange: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof PrioritySheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "優先度" };
