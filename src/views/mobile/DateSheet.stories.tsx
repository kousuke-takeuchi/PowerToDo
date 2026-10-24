import type { Meta, StoryObj } from "@storybook/react-vite";
import { TODAY } from "../../mock/data";
import { BottomSheet } from "./BottomSheet";
import { SheetFrame } from "./SheetFrame";
import { DateSheet } from "./DateSheet";

const meta = {
  title: "Views/Mobile/DateSheet",
  parameters: { layout: "centered" },
  render: (args) => (
    <SheetFrame>
      <BottomSheet open title={args.dateOnly ? "期限切れの日付" : "日付"} onClose={args.onClose}>
        <DateSheet {...args} />
      </BottomSheet>
    </SheetFrame>
  ),
  args: { today: TODAY, value: "2026-10-14", onChange: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof DateSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "日付" };
export const NoDate: Story = { name: "日付なし", args: { value: undefined } };
/** 期限切れの再スケジュール: 「日付なし」を出さない。 */
export const Reschedule: Story = { name: "再スケジュール", args: { value: undefined, dateOnly: true } };
