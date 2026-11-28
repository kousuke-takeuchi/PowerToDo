import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TODAY, sections } from "../../mock/data";
import { DOCS, installBackend } from "../../stories/docsBackend";
import type { Doc } from "../../types/model";
import { MobileDoc, MobileDocsList } from "./MobileDocs";

const meta = { title: "Views/Mobile/Docs", parameters: { layout: "fullscreen" }, globals: { viewport: { value: "mobile", isRotated: false } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Installs the fake backend before the first draw (the screens read in their own effects) and on every mount. */
function Backend({ docs, children }: { docs: Doc[]; children: React.ReactNode }) {
  useState(() => installBackend(docs));
  useEffect(() => installBackend(docs), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children}</>;
}

/** 「ドキュメント」の一覧 (spec 2026-11-28 §1): newest first, a row opens the document, 「+」 creates one. */
export const List: Story = {
  name: "ドキュメントの一覧",
  render: () => (
    <Backend docs={DOCS}>
      <MobileDocsList project="買い物" section={null} today={TODAY} onBack={() => undefined} onOpen={() => undefined} onNotice={() => undefined} />
    </Backend>
  ),
};

/** One document: the title, the body (Crepe with its top bar) and the 参考資料. */
export const Document: Story = {
  name: "ドキュメント (本文と参考資料)",
  render: () => (
    <Backend docs={DOCS}>
      <MobileDoc project="買い物" id={DOCS[0].id} sections={sections.map((s) => s.name)} today={TODAY} onBack={() => undefined} onGone={() => undefined} onNotice={() => undefined} />
    </Backend>
  ),
};

const NONE: Doc[] = [];

export const Empty: Story = {
  name: "空の一覧",
  render: () => (
    <Backend docs={NONE}>
      <MobileDocsList project="買い物" section="今週" today={TODAY} onBack={() => undefined} onOpen={() => undefined} onNotice={() => undefined} />
    </Backend>
  ),
};
