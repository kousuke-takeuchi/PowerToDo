/**
 * Japanese words for Milkdown Crepe's own UI (its defaults are English). Headings go to 3 levels (spec 2026-11-28 §1);
 * math is off (the Latex feature is turned off too). Pure data; the editor passes it in `featureConfigs`.
 */
export const HEADING_OPTIONS = [
  { label: "本文", level: null },
  { label: "見出し 1", level: 1 },
  { label: "見出し 2", level: 2 },
  { label: "見出し 3", level: 3 },
];

export const SLASH_MENU = {
  textGroup: {
    label: "文字",
    text: { label: "本文" },
    h1: { label: "見出し 1" },
    h2: { label: "見出し 2" },
    h3: { label: "見出し 3" },
    h4: null,
    h5: null,
    h6: null,
    quote: { label: "引用" },
    divider: { label: "区切り線" },
  },
  listGroup: {
    label: "リスト",
    bulletList: { label: "箇条書き" },
    orderedList: { label: "番号つき" },
    taskList: { label: "チェックボックス" },
  },
  advancedGroup: {
    label: "そのほか",
    image: { label: "画像" },
    codeBlock: { label: "コード" },
    table: { label: "表" },
    math: null,
  },
};

export const IMAGE_TEXTS = {
  inlineUploadButton: "ファイルを選ぶ",
  inlineUploadPlaceholderText: "または画像の URL を貼る",
  blockUploadButton: "ファイルを選ぶ",
  blockUploadPlaceholderText: "または画像の URL を貼る",
  blockConfirmButton: "決定",
  blockCaptionPlaceholderText: "画像の説明",
};

export const LINK_TEXTS = { inputPlaceholder: "リンクを貼る…" };
