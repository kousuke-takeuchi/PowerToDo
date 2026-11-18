import { createContext } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../../api/client";
import { onAttachmentsChanged } from "../../api/events";
import type { AttachmentInfo } from "../../types/model";
import { createBlobCache } from "./blobCache";

/** What the attachment views need from the app. The default talks to the backend; Storybook provides a fake. */
export interface AttachmentEnv {
  read: (f: AttachmentInfo) => Promise<ArrayBuffer>;
  open: (f: AttachmentInfo) => Promise<void>;
  reveal: (f: AttachmentInfo) => Promise<void>;
  saveAs: (f: AttachmentInfo) => Promise<void>;
  /** Calls back with the blob names (`<hash>.<ext>`) a sync wrote; returns the unsubscribe. */
  subscribe: (cb: (files: string[]) => void) => () => void;
  /** A sync is running or may start (so a missing blob is "同期中", not "見つかりません"). */
  syncing: boolean;
  onError: (e: unknown) => void;
}

export const defaultAttachmentEnv: AttachmentEnv = {
  read: (f) => api.readAttachment(f),
  open: (f) => api.openAttachment(f),
  reveal: (f) => api.revealAttachment(f),
  saveAs: async (f) => {
    const dest = await save({ defaultPath: f.name });
    if (dest) await api.saveAttachmentAs(f, dest);
  },
  subscribe: onAttachmentsChanged,
  syncing: false,
  onError: () => undefined,
};

export const AttachmentEnvContext = createContext<AttachmentEnv>(defaultAttachmentEnv);

/** One pool of object URLs for the whole window. */
export const blobCache = createBlobCache(
  (bytes, type) => URL.createObjectURL(new Blob([bytes], { type })),
  (url) => URL.revokeObjectURL(url),
);

/** Task key `${project}/${no}` -> number of attachments (comments' and the description's), for the row's paperclip. */
export const AttachmentCounts = createContext<Record<string, number>>({});
