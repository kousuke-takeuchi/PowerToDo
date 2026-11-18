import type { PlatformInfo } from "../types/model";

/** One line of the 「…」 menu. A submenu holds items only. */
export type MenuEntry =
  | { kind: "item"; id: string; label: string; shortcut?: string; danger?: boolean; onSelect: () => void }
  | { kind: "separator" }
  | { kind: "submenu"; id: string; label: string; items: MenuEntry[] };

export type ProjectMenuActions = {
  edit: () => void;
  toggleFavorite: () => void;
  addSection: () => void;
  openFile: () => void;
  revealFile: () => void;
  archive: () => void;
  delete: () => void;
};

/** 「Finder で表示」の文言 (Windows はエクスプローラー、Linux はファイルマネージャー)。 */
export function revealLabel(os: PlatformInfo["os"]): string {
  if (os === "windows") return "エクスプローラーで表示";
  if (os === "linux") return "ファイルマネージャーで表示";
  return "Finder で表示";
}

/**
 * 右上の「…」のメニュー (spec 2026-11-18 §4)。受信トレイはセクションの追加とデータの管理だけで、
 * 編集 / お気に入り / アーカイブ / 削除は出さない。区切り線の位置は Todoist に合わせる。
 * 今日・近日・ラベルは「…」自体を出さないので、ここには来ない。
 */
export function projectMenuEntries({
  inbox,
  archived = false,
  favorite,
  os,
  actions,
}: {
  inbox: boolean;
  /** アーカイブ済み: 読み取り専用なので、データの管理と削除だけ。 */
  archived?: boolean;
  favorite: boolean;
  os: PlatformInfo["os"];
  actions: ProjectMenuActions;
}): MenuEntry[] {
  const manage: MenuEntry = {
    kind: "submenu",
    id: "manage",
    label: "データを管理",
    items: [
      { kind: "item", id: "open-file", label: "Excel で開く", onSelect: actions.openFile },
      { kind: "item", id: "reveal-file", label: revealLabel(os), onSelect: actions.revealFile },
    ],
  };
  const addSection: MenuEntry = { kind: "item", id: "add-section", label: "セクションを追加", shortcut: "S", onSelect: actions.addSection };
  if (archived) return [manage, { kind: "separator" }, { kind: "item", id: "delete", label: "削除", danger: true, onSelect: actions.delete }];
  if (inbox) return [addSection, { kind: "separator" }, manage];
  return [
    { kind: "item", id: "edit", label: "編集", onSelect: actions.edit },
    {
      kind: "item",
      id: "favorite",
      label: favorite ? "お気に入りから外す" : "お気に入りに追加",
      onSelect: actions.toggleFavorite,
    },
    addSection,
    { kind: "separator" },
    manage,
    { kind: "separator" },
    { kind: "item", id: "archive", label: "アーカイブ", onSelect: actions.archive },
    { kind: "item", id: "delete", label: "削除", danger: true, onSelect: actions.delete },
  ];
}
