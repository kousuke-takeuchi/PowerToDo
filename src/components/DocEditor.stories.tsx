import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocEditor } from "./DocEditor";
import { ReferenceFiles } from "./ReferenceFiles";
import type { Doc } from "../types/model";

const SAMPLE = `# 目的

**太字** と *斜体* と ~~取り消し~~ と \`code\`。[リンク](https://example.com)

- 箇条 1
- 箇条 2

1. 番号 1
2. 番号 2

- [ ] やること
- [x] 済んだこと

> 引用

\`\`\`ts
const a = 1;
\`\`\`

| 列 1 | 列 2 |
| --- | --- |
| a | b |

![画面](../_attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png)

---

### 小見出し
`;

const doc: Doc = { id: "1792929845000-3f2a00000000009c", project: "仕事", title: "サンプルの文書", section: null, created: "2026-11-28T09:00:00", updated: "2026-11-28T09:00:00", author: "たろう", files: [], body: SAMPLE };

const meta = { title: "Components/DocEditor", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Body: Story = {
  name: "本文",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <DocEditor
        doc={doc}
        onSave={async (e) => {
          (window as unknown as { __lastBody?: string }).__lastBody = e.body;
        }}
      />
    </div>
  ),
};

export const Empty: Story = {
  name: "空の文書",
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <DocEditor doc={{ ...doc, title: "", body: "" }} onSave={async () => undefined} />
    </div>
  ),
};

export const Reference: Story = {
  name: "参考資料",
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <ReferenceFiles
        files={[
          { hash: "a".repeat(64), ext: "pdf", name: "仕様書.pdf", type: "application/pdf", size: 183000 },
          { hash: "b".repeat(64), ext: "png", name: "画面.png", type: "image/png", size: 1200000, w: 400, h: 300 },
        ]}
        onAdd={() => undefined}
        onOpen={() => undefined}
        onRemove={() => undefined}
      />
    </div>
  ),
};
