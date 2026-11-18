/**
 * Spec attachments §4: which images are shrunk before they are stored. Pure (the canvas work is in
 * `prepare.ts`), so the desktop and the iPhone screens share it and node --test covers it.
 */

/** Longest side kept, in px. */
export const MAX_SIDE = 2048;
/** JPEG quality of a shrunk or converted image. */
export const JPEG_QUALITY = 0.85;
/** One file, in bytes (the backend refuses more). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type ImageKind = "jpeg" | "png" | "webp" | "heic" | "gif" | "other";

const EXT_KIND: Record<string, ImageKind> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heic",
  gif: "gif",
};
const TYPE_KIND: Record<string, ImageKind> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "image/gif": "gif",
};

/** The extension of `name` in lower case, without the dot ("" when there is none). */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
}

/** The image kind from the MIME type, else from the extension (a HEIC file often comes with no type). */
export function imageKind(type: string, name: string): ImageKind {
  return TYPE_KIND[type.toLowerCase()] ?? EXT_KIND[extOf(name)] ?? "other";
}

export type ResizePlan = { action: "keep" } | { action: "jpeg"; w: number; h: number };

/**
 * What to do with a decoded image of `w` x `h`: over 2048 on the long side -> JPEG at 2048 (GIF excepted, to keep
 * the motion); HEIC is always JPEG; a PNG, WebP or JPEG within 2048 stays as it is.
 */
export function planResize(kind: ImageKind, w: number, h: number): ResizePlan {
  if (kind === "other" || kind === "gif") return { action: "keep" };
  const long = Math.max(w, h);
  if (long > MAX_SIDE) {
    const k = MAX_SIDE / long;
    return { action: "jpeg", w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  if (kind === "heic") return { action: "jpeg", w, h };
  return { action: "keep" };
}

/** `name` with its extension changed to `.jpg` (added when there is none). */
export function jpegName(name: string): string {
  const e = extOf(name);
  return `${e ? name.slice(0, name.length - e.length - 1) : name}.jpg`;
}

/** The message for a file over the cap, or null. */
export function sizeProblem(name: string, bytes: number): string | null {
  return bytes > MAX_FILE_BYTES ? `「${name}」は 50 MB を超えるため添付できません` : null;
}
