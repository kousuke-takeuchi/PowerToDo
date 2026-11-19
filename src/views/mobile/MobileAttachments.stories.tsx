import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AttachmentEnvContext, type AttachmentEnv } from "../../app/attachments/env";
import { nasConnected, syncStatuses, tailnets } from "../../mock/sync";
import { TODAY, projects, tasks } from "../../mock/data";
import type { AttachmentInfo, Comment, NoteFile } from "../../types/model";
import { MobileAttachmentViewer } from "./MobileAttachmentViewer";
import { MobileSettings } from "./MobileSettings";
import { MobileTaskDetail } from "./MobileTaskDetail";
import { MobileTaskRow } from "../../components/MobileTaskRow";

/** A colored picture of the given size, drawn on a canvas (Storybook has no backend to read blobs from). */
function drawPng(file: AttachmentInfo): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = file.w ?? 400;
  canvas.height = file.h ?? 300;
  const g = canvas.getContext("2d")!;
  const hue = (file.hash.charCodeAt(0) * 37) % 360;
  const grad = g.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, `hsl(${hue} 70% 70%)`);
  grad.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 45%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = `${Math.round(canvas.height / 8)}px sans-serif`;
  g.fillText(file.name, canvas.width / 20, canvas.height / 2);
  return new Promise((res) => canvas.toBlob((b) => void b!.arrayBuffer().then(res), "image/png"));
}

function Env({ children }: { children: React.ReactNode }) {
  const env = useMemo<AttachmentEnv>(
    () => ({ read: drawPng, open: async () => undefined, reveal: async () => undefined, saveAs: async () => undefined, subscribe: () => () => undefined, syncing: false, onError: () => undefined }),
    [],
  );
  return <AttachmentEnvContext.Provider value={env}>{children}</AttachmentEnvContext.Provider>;
}

const info = (name: string, type: string, extra: Partial<AttachmentInfo> = {}): AttachmentInfo => ({
  hash: `${name.length}${name}`.padEnd(64, "a"),
  ext: name.split(".").pop() ?? "bin",
  name,
  type,
  size: 183204,
  ...extra,
});
const shot = info("スクリーンショット.png", "image/png", { w: 1170, h: 2532 });
const photo = info("tana.jpg", "image/jpeg", { w: 1200, h: 800, size: 640_000 });
const tall = info("メモ.png", "image/png", { w: 600, h: 900, size: 90_000 });
const pdf = info("見積書.pdf", "application/pdf", { size: 2_400_000 });
const xlsx = info("工程表.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { size: 48_000 });

const base: Comment = { id: "c1", author: "たろう", at: "2026-10-12T21:30:00+09:00", text: "", edited: false, files: [] };
const comments: Comment[] = [
  { ...base, text: "先週は売り切れだった。棚の写真を貼る。", files: [photo, tall, pdf] },
  { ...base, id: "c2", at: "2026-10-12T22:10:00+09:00", text: "見積もりと工程表も。", files: [xlsx] },
  { ...base, id: "c3", author: "はなこ", at: "2026-10-13T08:00:00+09:00", text: "了解です" },
];
const notes: NoteFile[] = [photo, pdf].map((file, i) => ({ id: `n${i}`, at: "2026-11-18T09:00:00+09:00", author: "たろう", file }));
const noop = () => undefined;
const ok = () => Promise.resolve(true);

// 幅 390x844 (Screens/Mobile と同じ)。
const meta = {
  title: "Views/Mobile/Attachments",
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobile", isRotated: false } },
  decorators: [(Story) => <Env><Story /></Env>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const detailProps = {
  task: { ...tasks[0], note: "近所のスーパーで。棚の写真と見積書を付けた。" },
  subtasks: [],
  project: projects.find((p) => p.name === "買い物")!,
  section: "今週",
  today: TODAY,
  me: "たろう",
  onChange: noop,
  onAddComment: ok,
  onEditComment: ok,
  onDeleteComment: fn(),
  onAttachComment: () => Promise.resolve([] as AttachmentInfo[]),
  onAttachNote: fn(),
  onDetachNote: fn(),
};

export const CommentSheet: Story = {
  name: "コメントのシート (添付つき)",
  render: () => <MobileTaskDetail {...detailProps} comments={comments} noteFiles={notes} initialSheet="comments" />,
};

export const CommentSheetPending: Story = {
  name: "コメントのシート (送る前の添付)",
  render: () => <MobileTaskDetail {...detailProps} comments={comments.slice(2)} initialSheet="comments" initialPending={[shot, pdf, xlsx]} />,
};

export const CommentSheetEdit: Story = {
  name: "コメントのシート (編集)",
  render: () => <MobileTaskDetail {...detailProps} comments={comments} initialSheet="comments" initialCommentEdit="c1" />,
};

export const DetailWithFiles: Story = {
  name: "タスク詳細 (メモと最新コメントの添付)",
  render: () => <MobileTaskDetail {...detailProps} comments={comments} noteFiles={notes} />,
};

function ViewerHost({ files, start = 0 }: { files: AttachmentInfo[]; start?: number }) {
  const [i, setI] = useState(start);
  return <MobileAttachmentViewer files={files} index={i} onIndex={setI} onClose={fn()} />;
}

export const Viewer: Story = {
  name: "画像の全画面表示",
  render: () => <ViewerHost files={[shot, photo, tall]} />,
};

export const RowWithAttachments: Story = {
  name: "行のクリップ",
  render: () => (
    <div style={{ padding: "0 15px" }}>
      <MobileTaskRow done={false} title="食パンを買う" priority={4} commentCount={2} attachmentCount={3} date={{ label: "今日", tone: "success" }} />
    </div>
  ),
};

const syncPane = { settings: nasConnected, status: syncStatuses.synced, tailnet: tailnets.running, onChangeBackend: noop, onSyncNow: noop, onDisconnect: noop };

export const SettingsUsage: Story = {
  name: "設定 (添付の使用量)",
  render: () => <MobileSettings today={TODAY} sync={{ ...syncPane, attachmentUsage: { count: 14, bytes: 38_400_000 } }} onBack={noop} />,
};
