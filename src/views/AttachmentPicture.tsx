import type React from "react";
import { useContext, useState } from "react";
import { AttachmentEnvContext } from "../app/attachments/env";
import { missingLabel } from "../app/attachments/list";
import { useAttachmentBlob } from "../app/attachments/useBlob";
import type { AttachmentInfo } from "../types/model";

const grey: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  background: "var(--color-bg-hover)",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  lineHeight: "17px",
};

/** The picture frame: the picture, or a grey frame (同期中 / 見つかりません), or null when the webview cannot decode it. */
export function Picture({ file, box, fit, onShown }: { file: AttachmentInfo; box?: { w: number; h: number }; fit: "thumb" | "full" | "screen"; onShown?: (img: HTMLImageElement) => void }) {
  const env = useContext(AttachmentEnvContext);
  const blob = useAttachmentBlob(file);
  const [broken, setBroken] = useState(false);
  if (blob.status === "ready" && !broken) {
    return (
      <img
        src={blob.url}
        alt={file.name}
        draggable={false}
        onError={() => setBroken(true)}
        onLoad={onShown ? (e) => onShown(e.currentTarget) : undefined}
        style={
          fit === "thumb"
            ? { display: "block", width: box?.w, height: box?.h, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border)" }
            : fit === "screen"
              ? // The iPhone viewer: as big as fits the screen; its wrapper takes the touches (pinch / swipe).
                { display: "block", maxWidth: "100vw", maxHeight: "100dvh", objectFit: "contain", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", pointerEvents: "none" }
              : { display: "block", maxWidth: "min(90vw, 1600px)", maxHeight: "82vh", objectFit: "contain", borderRadius: 4 }
        }
      />
    );
  }
  const text = blob.status === "loading" ? "" : blob.status === "missing" ? missingLabel(env.syncing) : "表示できません";
  return (
    <div role="img" aria-label={`${file.name} ${text}`.trim()} style={{ ...grey, width: box?.w ?? 320, height: box?.h ?? 240, borderRadius: 6 }}>
      {text}
    </div>
  );
}
