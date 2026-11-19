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
  const decoded = await decode(file);
  if (!decoded) return asIs;
  const { src, w: sw, h: sh, release } = decoded;
  try {
    const plan = planResize(kind, sw, sh);
    if (plan.action === "keep") return { ...asIs, w: sw, h: sh };
    const canvas = document.createElement("canvas");
    canvas.width = plan.w;
    canvas.height = plan.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ...asIs, w: sw, h: sh };
    ctx.fillStyle = "#fff"; // transparency would turn black in a JPEG
    ctx.fillRect(0, 0, plan.w, plan.h);
    ctx.drawImage(src, 0, 0, plan.w, plan.h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    if (!blob) return { ...asIs, w: sw, h: sh };
    return { blob, name: jpegName(file.name), type: "image/jpeg", w: plan.w, h: plan.h };
  } finally {
    release();
  }
}

/**
 * Decodes with the EXIF orientation applied. `createImageBitmap` first; WKWebView (iPhone) may refuse a HEIC file
 * there while an <img> opens it, so that is the second try. null when the webview cannot open it at all.
 */
async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; release: () => void } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { src: bmp, w: bmp.width, h: bmp.height, release: () => bmp.close() };
  } catch {
    // fall through to <img>
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // <img> draws with its EXIF orientation (WebKit and Chromium), and naturalWidth is the displayed width.
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
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
