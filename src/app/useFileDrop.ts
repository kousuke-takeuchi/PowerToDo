import type React from "react";
import { useEffect, useRef, useState } from "react";
import { dragHasFiles, filesOf, pastedName } from "./attachments/drop";

/**
 * Drop zone props for a block that takes files (spec attachments §5). `over` is true while files are dragged over
 * it (for a highlight). A drop with files is handled here and does not bubble, so a zone inside another one
 * (the comment composer inside the dialog) wins.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const props = {
    onDragEnter: (e: React.DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      depth.current = 0;
      setOver(false);
      const files = filesOf(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      onFiles(files);
    },
  };
  return { over, props };
}

/**
 * With Tauri's own drag-drop off (`dragDropEnabled: false`, so the page gets DOM drops), a file dropped where no
 * zone takes it would make the webview navigate to the file. While mounted, such a drop is refused (no-drop cursor)
 * and its navigation cancelled. Zones stop the event before it reaches the window.
 */
export function useRefuseStrayFileDrops(): void {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.defaultPrevented || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    const drop = (e: DragEvent) => {
      if (!e.defaultPrevented && dragHasFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

/** A paste that carries files (a screenshot, a copied file) goes to `onFiles`; a plain-text paste is left alone. */
export function pasteFiles(e: React.ClipboardEvent, onFiles: (files: File[]) => void): void {
  const files = filesOf(e.clipboardData);
  if (files.length === 0) return;
  e.preventDefault();
  const now = new Date();
  onFiles(files.map((f) => {
    const name = pastedName(f.name, f.type, now);
    return name === f.name ? f : new File([f], name, { type: f.type });
  }));
}
