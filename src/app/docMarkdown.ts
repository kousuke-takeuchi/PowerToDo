/** Project documents (spec 2026-11-28): body image paths and the template. Pure; tested with node. */
const PREFIX = "../_attachments/";

export function attachmentOfSrc(src: string): { hash: string; ext: string } | null {
  if (!src.startsWith(PREFIX)) return null;
  const m = /^([0-9a-f]{64})(?:\.([0-9a-z]{1,16}))?$/.exec(src.slice(PREFIX.length));
  return m ? { hash: m[1], ext: m[2] ?? "" } : null;
}

export function srcOfAttachment(f: { hash: string; ext: string }): string {
  return f.ext ? `${PREFIX}${f.hash}.${f.ext}` : `${PREFIX}${f.hash}`;
}

export const DOC_TEMPLATE = "## 目的\n\n## 経緯\n\n## リンク\n\n## 要望\n\n## やりたいこと\n";

export function isEmptyBody(md: string): boolean {
  return md.replace(/<br\s*\/?>/g, "").trim() === "";
}

/**
 * Alt text of a block image. Milkdown's image block keeps its resize ratio in the alt (`![1.00](…)`); a numeric alt
 * is read as that ratio, any other alt is kept as text (ratio 1). On write, a text alt wins over the ratio.
 */
export function imageBlockAltIn(alt: string | null | undefined): { alt: string; ratio: number } {
  const a = (alt ?? "").trim();
  if (a === "") return { alt: "", ratio: 1 };
  const n = Number(a);
  if (Number.isNaN(n)) return { alt: alt ?? "", ratio: 1 };
  return { alt: "", ratio: n === 0 ? 1 : n };
}

export function imageBlockAltOut(alt: string, ratio: number): string {
  return alt !== "" ? alt : Number.parseFloat(String(ratio)).toFixed(2);
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** The MIME type of an image by its extension, or undefined when it is not one of the known images. */
export function imageTypeOfExt(ext: string): string | undefined {
  return IMAGE_TYPES[ext.toLowerCase()];
}

