import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BottomSheet, SheetRow } from "./BottomSheet";
import { SheetFrame } from "./SheetFrame";

const meta = { title: "Views/Mobile/BottomSheet", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  name: "開いた状態",
  render: () => {
    const Demo = () => {
      const [open, setOpen] = useState(true);
      return (
        <SheetFrame>
          <BottomSheet open={open} title="タイトル" onClose={() => setOpen(false)}>
            <SheetRow label="項目 1" />
            <SheetRow label="項目 2" selected />
          </BottomSheet>
          {!open && (
            <button type="button" style={{ pointerEvents: "auto", margin: 16 }} onClick={() => setOpen(true)}>
              もう一度開く
            </button>
          )}
        </SheetFrame>
      );
    };
    return <Demo />;
  },
};
