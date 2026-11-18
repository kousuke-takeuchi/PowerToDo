import { api } from "../../api/client";
import type { AttachmentInfo } from "../../types/model";
import { JPEG_QUALITY, imageKind, jpegName, planResize, sizeProblem } from "./resize";

export interface Prepared {
  blob: Blob;
  name: string;
  type: string;
  w?: number;
  h?: number;
}

/**
 * Decodes and shrinks one picked file (spec attachments §4). Images the webview cannot open are returned as they
 * are, to be attached as files. The EXIF orientation is applied when decoding, so the sizes are the displayed ones.
 */
export async function prepareFile(file: File): Promise<Prepared> {
  const type = file.type || "application/octet-stream";
  const asIs: Prepared = { blob: file, name: file.name, type };
  const kind = imageKind(file.type, file.name);
  if (kind === "other") return asIs;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return asIs;
  }
  try {
    const plan = planResize(kind, bmp.width, bmp.height);
    if (plan.action === "keep") return { ...asIs, w: bmp.width, h: bmp.height };
    const canvas = document.createElement("canvas");
    canvas.width = plan.w;
    canvas.height = plan.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ...asIs, w: bmp.width, h: bmp.height };
    ctx.fillStyle = "#fff"; // transparency would turn black in a JPEG
    ctx.fillRect(0, 0, plan.w, plan.h);
    ctx.drawImage(bmp, 0, 0, plan.w, plan.h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    if (!blob) return { ...asIs, w: bmp.width, h: bmp.height };
    return { blob, name: jpegName(file.name), type: "image/jpeg", w: plan.w, h: plan.h };
  } finally {
    bmp.close();
  }
}

/**
 * Shrinks and stores each file; resolves the stored ones. A file over the cap, or one the backend refuses, is
 * reported through `onError` and left out (the rest still go).
 */
export async function storeFiles(files: File[], onError: (e: unknown) => void): Promise<AttachmentInfo[]> {
  const out: AttachmentInfo[] = [];
  for (const f of files) {
    try {
      const p = await prepareFile(f);
      const problem = sizeProblem(p.name, p.blob.size);
      if (problem) throw new Error(problem);
      out.push(await api.addAttachment(await p.blob.arrayBuffer(), { name: p.name, type: p.type, w: p.w, h: p.h }));
    } catch (e) {
      onError(e);
    }
  }
  return out;
}
