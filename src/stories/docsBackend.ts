/** Storybook stand-ins for the documents screens (desktop and iPhone): sample documents and a fake backend. */
import type { Doc, DocEdit, DocSummary } from "../types/model";

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

export const sample = (id: string, title: string, section: string | null, updated: string, files = 0, body = ""): Doc => ({
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

export const DOCS: Doc[] = [
  sample("1792929845000-3f2a00000000009c", "見積もりの流れ", null, "2026-11-28T09:12:00", 2, BODY),
  sample("1792929845001-3f2a00000000009d", "買い物のルール", "今週", "2026-11-27T18:40:00", 0, "# ルール\n\n- 日曜にまとめて買う\n"),
  sample("1792929845002-3f2a00000000009e", "会議のメモ", "今週", "2026-11-26T11:05:00", 1, "メモ\n"),
];

const summary = (d: Doc): DocSummary => ({ id: d.id, project: d.project, title: d.title, section: d.section, updated: d.updated, author: d.author, files: d.files.length });

/** What `window` had before the first stub, put back when a story leaves. */
let original: { internals: unknown; events: unknown } | undefined;
const stores = new WeakMap<Doc[], Map<string, Doc>>();

/** Stands in for the Tauri side: Storybook has no backend, so the commands the pane calls answer from `docs`. */
export function installBackend(docs: Doc[]): () => void {
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

