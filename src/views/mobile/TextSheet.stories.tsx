import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { SheetFrame } from "./SheetFrame";
import { TEXT_SHEET_FORM, TextSheet } from "./TextSheet";

const meta = { title: "Views/Mobile/TextSheet", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AddSubtask: Story = {
  name: "サブタスクを追加",
  render: () => {
    const Demo = () => {
      const [open, setOpen] = useState(true);
      const [saves, setSaves] = useState<string[]>([]);
      return (
        <SheetFrame>
          <div data-saves={saves.length} style={{ margin: 16, pointerEvents: "auto" }}>
            保存: {saves.length} 回 {saves.join(", ")}
            {!open && (
              <button type="button" style={{ marginLeft: 8 }} onClick={() => setOpen(true)}>
                もう一度開く
              </button>
            )}
          </div>
          <BottomSheet open={open} title="サブタスクを追加" confirmForm={TEXT_SHEET_FORM} onClose={() => setOpen(false)}>
            <TextSheet label="サブタスク名" value="" placeholder="サブタスク名" onSave={(v) => setSaves((s) => [...s, v])} onClose={() => setOpen(false)} />
          </BottomSheet>
        </SheetFrame>
      );
    };
    return <Demo />;
  },
};
