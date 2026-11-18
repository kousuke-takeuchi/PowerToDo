import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { DueTextDto } from "../types/model";
import { TODAY } from "../mock/data";
import { DatePicker } from "./DatePicker";
import { DueParserContext } from "./DueParserContext";

// Rust の parse_due_text の代わり。表の数件だけ解釈する (TODAY を基準にした固定の答え)。
const TABLE: Record<string, DueTextDto> = {
  明日: { due: "2026-10-14", time: null, rrule: null, label: "10/14 (水)" },
  "金曜 15:00": { due: "2026-10-16", time: "15:00", rrule: null, label: "10/16 (金) 15:00" },
  毎週水曜: { due: "2026-10-14", time: null, rrule: "FREQ=WEEKLY;BYDAY=WE", label: "毎週水曜 (10/14 から)" },
};
const mockParse = async (text: string): Promise<DueTextDto | null> => {
  await new Promise((r) => setTimeout(r, 80));
  return TABLE[text.trim()] ?? null;
};

const meta = {
  title: "Views/DatePicker",
  component: DatePicker,
  args: { onChange: fn(), onDone: fn(), onOpenRecurrence: fn(), today: TODAY },
  decorators: [
    (Story) => (
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DatePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "既定" };

export const TypedText: Story = {
  name: "日付欄の入力 (操作)",
  // 明日 / 金曜 15:00 / 毎週水曜 を入力 → 300ms 後に「→ ...」のプレビュー → Enter で日付 (と時刻、繰り返し) を確定。それ以外は「解釈できません」。
  decorators: [
    (Story) => (
      <DueParserContext.Provider value={mockParse}>
        <Story />
      </DueParserContext.Provider>
    ),
  ],
};
