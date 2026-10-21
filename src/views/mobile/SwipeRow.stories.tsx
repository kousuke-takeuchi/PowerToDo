import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskRow } from "../../components/TaskRow";
import { SwipeRow } from "./SwipeRow";

const row = <TaskRow variant="mobile" title="牛乳と卵を買う" done={false} priority={1} date={{ label: "明日", tone: "muted" }} />;

const meta = {
  args: { children: row },
  title: "Views/Mobile/SwipeRow",
  parameters: { layout: "centered" },
  decorators: [(Story) => <div style={{ width: 358 }}><Story /></div>],
} satisfies Meta<typeof SwipeRow>;
export default meta;
type Story = StoryObj<typeof meta>;


export const Rest: Story = { name: "静止", args: {} };
/** 右へ 98 動かした状態 (離すと完了。SWIPE_TRIGGER は 80)。 */
export const SwipingRight: Story = { name: "スワイプ中 右 (完了)", args: { initialOffset: 98 } };
/** 左へ 98 動かした状態 (離すと日付のシート)。 */
export const SwipingLeft: Story = { name: "スワイプ中 左 (日付)", args: { initialOffset: -98 } };
export const Disabled: Story = { name: "無効", args: { disabled: true } };
