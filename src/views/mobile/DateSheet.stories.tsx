import type { Meta, StoryObj } from "@storybook/react-vite";
import { TODAY } from "../../mock/data";
import { BottomSheet } from "./BottomSheet";
import { SheetFrame } from "./SheetFrame";
import { DATE_SHEET_FORM, DateSheet } from "./DateSheet";

const meta = {
  title: "Views/Mobile/DateSheet",
  parameters: { layout: "centered" },
  render: (args) => (
    <SheetFrame>
      <BottomSheet open size="large" confirmForm={DATE_SHEET_FORM} title={args.dateOnly ? "期限切れの日付" : "日付"} onClose={args.onClose}>
        <DateSheet {...args} />
      </BottomSheet>
    </SheetFrame>
  ),
  args: { today: TODAY, value: "2026-10-14", onApply: () => undefined, onClose: () => undefined },
} satisfies Meta<typeof DateSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "日付" };
/** 「時間」のページ: 時と分 (5 分刻み) のドラムロール。 */
export const TimePage: Story = { name: "時間のページ", args: { value: "2026-10-14", time: "10:30", initialPage: "time" } };
export const NoDate: Story = { name: "日付なし", args: { value: undefined } };
/** 期限切れの再スケジュール: 「日付なし」を出さない。 */
export const Reschedule: Story = { name: "再スケジュール", args: { value: undefined, dateOnly: true } };
