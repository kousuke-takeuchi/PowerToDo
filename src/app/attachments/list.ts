import type { AttachmentInfo, NoteFile } from "../../types/model";
import { imageKind } from "./resize.ts";

/** Largest height of a thumbnail (spec attachments §5) and widest. */
export const THUMB_MAX_H = 120;
export const THUMB_MAX_W = 320;

export type AttachmentItem =
  | { kind: "image"; key: string; file: AttachmentInfo; box: { w: number; h: number }; viewIndex: number }
  | { kind: "chip"; key: string; file: AttachmentInfo; sizeText: string };

/** "183 KB", "1.2 MB" (powers of 1024, one decimal from MB up). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** The frame of a thumbnail: the picture's proportions, at most 120 high and 320 wide (a square 120 when the size is unknown). */
export function thumbBox(w?: number, h?: number): { w: number; h: number } {
  if (!w || !h) return { w: THUMB_MAX_H, h: THUMB_MAX_H };
  let k = Math.min(1, THUMB_MAX_H / h);
  k = Math.min(k, THUMB_MAX_W / w);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** True when the webview can show the file as a picture (HEIC and the like go to a chip). */
export function isShownAsImage(f: AttachmentInfo): boolean {
  const k = imageKind(f.type, `x.${f.ext}`);
  return k === "jpeg" || k === "png" || k === "webp" || k === "gif";
}

/**
 * The row of attachments under a comment or a description: pictures first as thumbnails (in their order, with
 * the index they have in the viewer), the other files as name + size chips.
 */
export function buildAttachmentList(files: AttachmentInfo[], ids?: string[]): { items: AttachmentItem[]; images: AttachmentInfo[] } {
  const images: AttachmentInfo[] = [];
  const pics: AttachmentItem[] = [];
  const chips: AttachmentItem[] = [];
  files.forEach((file, i) => {
    const key = `${ids?.[i] ?? i}:${file.hash}`;
    if (isShownAsImage(file)) {
      pics.push({ kind: "image", key, file, box: thumbBox(file.w, file.h), viewIndex: images.length });
      images.push(file);
    } else chips.push({ kind: "chip", key, file, sizeText: formatBytes(file.size) });
  });
  return { items: [...pics, ...chips], images };
}

/** The files of a description, in the order they were attached. */
export function noteInfos(notes: NoteFile[]): { files: AttachmentInfo[]; ids: string[] } {
  return { files: notes.map((n) => n.file), ids: notes.map((n) => n.id) };
}

/** Next index in the viewer after a ← / → (no wrap-around). */
export function stepViewer(index: number, delta: -1 | 1, count: number): number {
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** True when `a` and `b` hold the same files in the same order (an edit that changed nothing sends no `files`). */
export function sameFiles(a: AttachmentInfo[], b: AttachmentInfo[]): boolean {
  return a.length === b.length && a.every((f, i) => f.hash === b[i].hash && f.name === b[i].name);
}

/** The grey frame's text while a blob is missing: "同期中" while a sync may still bring it, else "見つかりません" (spec §9). */
export function missingLabel(syncing: boolean): string {
  return syncing ? "同期中" : "見つかりません";
}
