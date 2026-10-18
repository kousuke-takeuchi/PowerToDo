import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { NasGuideDialog } from "./NasGuideDialog";

const meta = {
  title: "Views/NasGuideDialog",
  component: NasGuideDialog,
  parameters: { layout: "fullscreen" },
  args: { open: true, onClose: fn() },
} satisfies Meta<typeof NasGuideDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 親が位置を持つ要素 (ここでは 1000x700 の枠) の中に全面を覆って出る。 */
function Frame({ open, onClose }: { open: boolean; onClose?: () => void }) {
  const [o, setO] = useState(open);
  return (
    <div style={{ position: "relative", width: 1000, height: 700, background: "var(--color-bg)", color: "var(--color-text-primary)", fontFamily: "var(--font-body)", padding: 24 }}>
      <button type="button" onClick={() => setO(true)}>
        手順を開く
      </button>
      <NasGuideDialog
        open={o}
        onClose={() => {
          setO(false);
          onClose?.();
        }}
      />
    </div>
  );
}

export const 開いた状態: Story = { render: (a) => <Frame open={a.open} onClose={a.onClose} /> };
