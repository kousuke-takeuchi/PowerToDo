import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RecurrencePicker } from "./RecurrencePicker";

// Rust の parse_recurrence の代わり。表の数件だけ解釈する。
const TABLE: Record<string, { rrule: string; label: string }> = {
  毎週月曜: { rrule: "FREQ=WEEKLY;BYDAY=MO", label: "毎週月曜" },
  毎月末: { rrule: "FREQ=MONTHLY;BYMONTHDAY=-1", label: "毎月末" },
  "3日ごと!": { rrule: "FREQ=DAILY;INTERVAL=3;X-FROM-COMPLETION=1", label: "完了日から 3 日ごと" },
};
const mockParse = async (text: string) => {
  await new Promise((r) => setTimeout(r, 80));
  return TABLE[text.trim()] ?? { rrule: null, label: null };
};

const meta = {
  title: "Views/RecurrencePicker",
  component: RecurrencePicker,
  args: { onChange: fn() },
  decorators: [
    (Story) => (
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecurrencePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "既定", args: { value: "FREQ=WEEKLY;BYDAY=SA" } };

export const NaturalLanguage: Story = {
  name: "自然言語入力 (操作)",
  // 毎週月曜 / 毎月末 / 3日ごと! を入力 → 300ms 後にプレビュー → Enter で選択 → 適用。それ以外は「解釈できません」。
  args: { onParse: mockParse },
};
