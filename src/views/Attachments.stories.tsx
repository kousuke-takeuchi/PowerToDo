import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AttachmentEnvContext, type AttachmentEnv } from "../app/attachments/env";
import { TODAY, projects, tasks } from "../mock/data";
import type { AttachmentInfo, Comment, NoteFile } from "../types/model";
import { AttachmentList, AttachmentViewer } from "./Attachments";
import { CommentsSection } from "./CommentsSection";
import { TaskDialog } from "./TaskDialog";

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

const notFound = () => Promise.reject({ kind: "not_found", message: "なし" });

function Env({ children, missing, syncing = false }: { children: React.ReactNode; missing?: boolean; syncing?: boolean }) {
  const env = useMemo<AttachmentEnv>(
    () => ({
      read: (f) => (missing ? notFound() : drawPng(f)),
      open: async () => undefined,
      reveal: async () => undefined,
      saveAs: async () => undefined,
      subscribe: () => () => undefined,
      syncing,
      onError: () => undefined,
    }),
    [missing, syncing],
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
const shot = info("スクリーンショット.png", "image/png", { w: 1600, h: 900 });
const tall = info("メモ.png", "image/png", { w: 600, h: 900, size: 90_000 });
const photo = info("tana.jpg", "image/jpeg", { w: 1200, h: 800, size: 640_000 });
const pdf = info("見積書.pdf", "application/pdf", { size: 2_400_000 });
const xlsx = info("工程表.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { size: 48_000 });
const heic = info("IMG_0042.heic", "image/heic", { size: 3_100_000 });

const base: Comment = { id: "c1", author: "たろう", at: "2026-10-12T21:30:00+09:00", text: "", edited: false, files: [] };
const comments: Comment[] = [
  { ...base, text: "先週は売り切れだった。棚の写真を貼る。", files: [shot, photo, pdf] },
  { ...base, id: "c2", at: "2026-10-12T22:10:00+09:00", text: "", files: [tall, xlsx, heic] },
  { ...base, id: "c3", author: "はなこ", at: "2026-10-13T08:00:00+09:00", text: "了解です" },
];

const meta = {
  title: "Views/Attachments",
  parameters: { layout: "padded" },
  decorators: [(Story) => <Env><div style={{ maxWidth: 520 }}><Story /></div></Env>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const CommentsWithAttachments: Story = {
  name: "コメント (添付つき)",
  render: () => <CommentsSection comments={comments} me="たろう" onAdd={() => Promise.resolve(true)} onEdit={() => Promise.resolve(true)} onDelete={fn()} onAttach={() => Promise.resolve([])} />,
};

export const Pending: Story = {
  name: "コメント (送る前の添付)",
  render: () => <CommentsSection comments={[]} me="たろう" onAdd={() => Promise.resolve(true)} onAttach={() => Promise.resolve([])} initialPending={[shot, pdf, xlsx]} />,
};

export const EditWithFiles: Story = {
  name: "コメントの編集 (添付つき)",
  render: () => <CommentsSection comments={comments} me="たろう" initialEditId="c1" onAdd={() => Promise.resolve(true)} onEdit={() => Promise.resolve(true)} onDelete={fn()} onAttach={() => Promise.resolve([])} />,
};

export const DescriptionRow: Story = {
  name: "説明の添付の並び",
  render: () => <AttachmentList files={[shot, tall, pdf]} ids={["n1", "n2", "n3"]} onRemove={fn()} />,
};

function ViewerHost({ files, start = 0 }: { files: AttachmentInfo[]; start?: number }) {
  const [i, setI] = useState(start);
  return <AttachmentViewer files={files} index={i} onIndex={setI} onClose={fn()} />;
}

export const Viewer: Story = {
  name: "大きく表示",
  parameters: { layout: "fullscreen" },
  render: () => <ViewerHost files={[shot, tall, photo]} />,
};

export const ViewerMissingSyncing: Story = {
  name: "大きく表示 (同期中)",
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <Env missing syncing><Story /></Env>],
  render: () => <ViewerHost files={[shot]} />,
};

export const ViewerMissing: Story = {
  name: "大きく表示 (見つかりません)",
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <Env missing><Story /></Env>],
  render: () => <ViewerHost files={[shot]} />,
};

const notes: NoteFile[] = [shot, pdf].map((file, i) => ({ id: `n${i}`, at: "2026-11-18T09:00:00+09:00", author: "たろう", file }));

export const DialogWithNoteFiles: Story = {
  name: "タスク詳細 (説明の添付)",
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <Env><div style={{ position: "relative", height: 860 }}><Story /></div></Env>],
  render: () => (
    <TaskDialog
      task={{ ...tasks[0], note: "近所のスーパーで。棚の写真と見積書を付けた。" }}
      subtasks={[]}
      project={projects.find((p) => p.name === "買い物")!}
      today={TODAY}
      comments={comments}
      me="たろう"
      onChange={() => Promise.resolve(true)}
      onAddComment={() => Promise.resolve(true)}
      onEditComment={() => Promise.resolve(true)}
      onDeleteComment={fn()}
      onAttachComment={() => Promise.resolve([])}
      noteFiles={notes}
      onAttachNote={fn()}
      onDetachNote={fn()}
    />
  ),
};
