/**
 * Spec attachments §5: where a pasted or dropped file goes (the comment or the description). Structural types, so
 * node --test needs no DOM.
 */
export type FileZone = "composer" | "description" | "dialog";
export type FileTarget = "comment" | "note";

/** The comment composer takes its own files; anywhere else in the dialog (and the description field) is the description. */
export function routeFiles(zone: FileZone): FileTarget {
  return zone === "composer" ? "comment" : "note";
}

type TransferLike = { files?: ArrayLike<File> | null; types?: ArrayLike<string> | readonly string[] | null };

/** The files of a paste or a drop (empty when it carries only text). */
export function filesOf(dt: TransferLike | null | undefined): File[] {
  return dt?.files ? Array.from(dt.files) : [];
}

/** True while a drag carries files (not text or a link), so the zone may light up and accept. */
export function dragHasFiles(dt: TransferLike | null | undefined): boolean {
  return !!dt?.types && Array.from(dt.types).includes("Files");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A pasted screenshot is named "image.png" (or nothing): give it a name that tells when it was taken. */
export function pastedName(name: string, type: string, now: Date): string {
  if (name && !/^image\.\w+$/i.test(name)) return name;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : (type.split("/")[1] ?? "png").replace("jpeg", "jpg");
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `画像 ${d}.${ext}`;
}
