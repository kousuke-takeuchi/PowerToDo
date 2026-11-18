import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { Button } from "../components/Button";
import { PopRow, PopoverShell } from "./PopoverShell";
import { useFitPopover } from "./useFitPopover";

const meta = { title: "Views/PopoverShell", component: PopoverShell } satisfies Meta<typeof PopoverShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "既定",
  args: { label: "例", children: <PopRow>項目</PopRow> },
};

function Crowded() {
  const ref = useRef<HTMLDivElement>(null);
  useFitPopover(ref, true);
  return (
    <div style={{ position: "relative", height: 260, border: "1px dashed var(--color-border)" }}>
      <div ref={ref} style={{ position: "absolute", right: 8, top: 120, display: "flex", flexDirection: "column" }}>
        <PopoverShell
          label="長い例"
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="secondary">解除</Button>
              <Button variant="primary">適用</Button>
            </div>
          }
        >
          {Array.from({ length: 20 }, (_, i) => (
            <PopRow key={i}>項目 {i + 1}</PopRow>
          ))}
        </PopoverShell>
      </div>
    </div>
  );
}

export const WindowFit: Story = {
  name: "ウインドウに収める (中だけスクロール)",
  args: { label: "長い例", children: null },
  render: () => <Crowded />,
};
