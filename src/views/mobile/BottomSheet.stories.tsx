import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BottomSheet, SheetCard, SheetRow } from "./BottomSheet";
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
            <SheetCard>
              <SheetRow label="項目 1" />
              <SheetRow label="項目 2" selected />
            </SheetCard>
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

export const Large: Story = {
  name: "大 (85% から全画面へ)",
  render: () => {
    const Demo = () => {
      const [open, setOpen] = useState(true);
      return (
        <SheetFrame>
          <BottomSheet open={open} size="large" title="移動" onClose={() => setOpen(false)}>
            <SheetCard>
              {Array.from({ length: 14 }, (_, i) => (
                <SheetRow key={i} label={`項目 ${i + 1}`} />
              ))}
            </SheetCard>
          </BottomSheet>
        </SheetFrame>
      );
    };
    return <Demo />;
  },
};

export const Swap: Story = {
  name: "開く・メニューから移動へ",
  render: () => {
    const Demo = () => {
      const [open, setOpen] = useState(false);
      const [kind, setKind] = useState<"menu" | "move">("menu");
      const close = () => setOpen(false);
      return (
        <SheetFrame>
          <BottomSheet open={open} size={kind === "move" ? "large" : "auto"} title={kind === "move" ? "移動" : "タスク"} onClose={close}>
            {kind === "menu" ? (
              <SheetCard>
                <SheetRow label="日付" onClick={close} />
                <SheetRow label="優先度" onClick={close} />
                <SheetRow label="移動" onClick={() => setKind("move")} />
                <SheetRow label="削除" danger onClick={close} />
              </SheetCard>
            ) : (
              <SheetCard>
                {Array.from({ length: 14 }, (_, i) => (
                  <SheetRow key={i} label={`プロジェクト ${i + 1}`} onClick={close} />
                ))}
              </SheetCard>
            )}
          </BottomSheet>
          {!open && (
            <button
              type="button"
              style={{ pointerEvents: "auto", margin: 16 }}
              onClick={() => {
                setKind("menu");
                setOpen(true);
              }}
            >
              開く
            </button>
          )}
        </SheetFrame>
      );
    };
    return <Demo />;
  },
};
