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
