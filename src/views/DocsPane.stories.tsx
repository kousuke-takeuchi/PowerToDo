import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { TODAY, counts, projects, sections, tasks } from "../mock/data";
import type { Doc, DocEdit, DocSummary } from "../types/model";
import { AppShell } from "./AppShell";
import { DocsPane } from "./DocsPane";
import { ProjectView } from "./ProjectView";
import { Sidebar } from "./Sidebar";
import { Toast } from "../components/Toast";

const BODY = `# 目的

新しい **見積もりの流れ** をそろえる。*詳細* は参考資料を見る。

## やること

- [x] 現状の洗い出し
- [ ] 見積もりの雛形を作る
- [ ] 関係者に回す

## 比較

| 項目 | 今 | 変更後 |
| --- | --- | --- |
| 作る時間 | 2 時間 | 30 分 |
| 確認する人 | 3 人 | 1 人 |
`;

const sample = (id: string, title: string, section: string | null, updated: string, files = 0, body = ""): Doc => ({
  id,
  project: "買い物",
  title,
  section,
  created: "2026-11-20T10:00:00",
  updated,
  author: "たろう",
  files: Array.from({ length: files }, (_, i) => ({ hash: String(i + 1).repeat(64), ext: i === 0 ? "pdf" : "png", name: i === 0 ? "見積もり.pdf" : "画面.png", type: i === 0 ? "application/pdf" : "image/png", size: 183000 + i * 900000 })),
  body,
});

const DOCS: Doc[] = [
  sample("1792929845000-3f2a00000000009c", "見積もりの流れ", null, "2026-11-28T09:12:00", 2, BODY),
  sample("1792929845001-3f2a00000000009d", "買い物のルール", "今週", "2026-11-27T18:40:00", 0, "# ルール\n\n- 日曜にまとめて買う\n"),
  sample("1792929845002-3f2a00000000009e", "会議のメモ", "今週", "2026-11-26T11:05:00", 1, "メモ\n"),
];

const summary = (d: Doc): DocSummary => ({ id: d.id, project: d.project, title: d.title, section: d.section, updated: d.updated, author: d.author, files: d.files.length });

/** What `window` had before the first stub, put back when a story leaves. */
let original: { internals: unknown; events: unknown } | undefined;
const stores = new WeakMap<Doc[], Map<string, Doc>>();

/** Stands in for the Tauri side: Storybook has no backend, so the commands the pane calls answer from `docs`. */
function installBackend(docs: Doc[]): () => void {
  // One store per story's documents, so a second install (double mount) keeps what the first one saved.
  const store = stores.get(docs) ?? new Map(docs.map((d) => [d.id, { ...d }]));
  stores.set(docs, store);
  let cb = 0;
  const w = window as unknown as Record<string, unknown>;
  original ??= { internals: w.__TAURI_INTERNALS__, events: w.__TAURI_EVENT_PLUGIN_INTERNALS__ };
  const before = original;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
  w.__TAURI_INTERNALS__ = {
    transformCallback: () => ++cb,
    unregisterCallback: () => undefined,
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      switch (cmd) {
        case "plugin:event|listen":
          return ++cb;
        case "plugin:event|unlisten":
          return null;
        case "list_docs":
          return [...store.values()].map(summary);
        case "read_doc":
          return store.get(args.id as string);
        case "create_doc": {
          const d = sample(`${Date.now()}-0000000000000000`, args.title as string, args.section as string | null, "2026-11-28T10:00:00", 0, args.body as string);
          store.set(d.id, d);
          return d;
        }
        case "save_doc": {
          const d = store.get(args.id as string)!;
          const edit = args.edit as DocEdit;
          const next = { ...d, ...edit, updated: "2026-11-28T10:01:00" } as Doc;
          store.set(d.id, next);
          return { kind: "written", ...next };
        }
        case "delete_doc":
          store.delete(args.id as string);
          return null;
        default:
          throw new Error(`no backend for ${cmd}`);
      }
    },
  };
  // Put back what was there, so stories viewed later in the same Storybook keep their own setup.
  return () => {
    w.__TAURI_INTERNALS__ = before.internals;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = before.events;
  };
}

function Frame({ docs, section = null, open }: { docs: Doc[]; section?: string | null; open?: string }) {
  // Installed before the first draw (the pane reads in its own effects, which run first) and again on every mount
  // (React's development double mount runs the cleanup in between); the cleanup puts the original back.
  useState(() => installBackend(docs));
  useEffect(() => installBackend(docs), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [sec, setSec] = useState<string | null>(section);
  const [note, setNote] = useState<string | null>(null);
  return (
    <AppShell
      sidebar={<Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="synced" lastSyncedAt="09:41" />}
      syncState="synced"
    >
      <ProjectView project="買い物" tasks={tasks} sections={sections} today={TODAY} mode="docs" onMode={() => undefined} />
      <DocsPane key={open ?? "none"} project="買い物" section={sec} onSection={setSec} sections={sections.map((s) => s.name)} onNotice={setNote} initialOpen={open} />
      {note && <Toast text={note} actionLabel="閉じる" onAction={() => setNote(null)} onClose={() => setNote(null)} />}
    </AppShell>
  );
}

const meta = { title: "Views/Docs", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListAndBody: Story = {
  name: "一覧と本文",
  render: () => <Frame docs={DOCS} open={DOCS[0].id} />,
};

export const Empty: Story = {
  name: "空",
  render: () => <Frame docs={[]} />,
};

export const BySection: Story = {
  name: "セクションで絞る",
  render: () => <Frame docs={DOCS} section="今週" open={DOCS[1].id} />,
};
