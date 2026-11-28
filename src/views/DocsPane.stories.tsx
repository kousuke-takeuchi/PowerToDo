import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { TODAY, counts, projects, sections, tasks } from "../mock/data";
import type { Doc } from "../types/model";
import { DOCS, installBackend } from "../stories/docsBackend";
import { AppShell } from "./AppShell";
import { DocsPane } from "./DocsPane";
import { ProjectView } from "./ProjectView";
import { Sidebar } from "./Sidebar";
import { Toast } from "../components/Toast";

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
