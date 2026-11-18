import { useContext, useEffect, useRef, useState } from "react";
import { isAppError } from "../../api/client";
import type { AttachmentInfo } from "../../types/model";
import { AttachmentEnvContext, blobCache } from "./env";

/** loading -> ready (a URL for <img>), missing (not synced here yet), error (unreadable). */
export type BlobState = { status: "loading" } | { status: "ready"; url: string } | { status: "missing" } | { status: "error" };

/** The picture of an attachment as an object URL from the shared pool; read again when a sync brings the blob. */
export function useAttachmentBlob(file: AttachmentInfo): BlobState {
  const env = useContext(AttachmentEnvContext);
  const envRef = useRef(env);
  envRef.current = env;
  const key = `${file.hash}.${file.ext}`;
  const [state, setState] = useState<BlobState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let held = false;
    setState({ status: "loading" });
    blobCache.acquire(key, () => envRef.current.read(file), file.type).then(
      (url) => {
        if (!alive) {
          blobCache.release(key);
          return;
        }
        held = true;
        setState({ status: "ready", url });
      },
      (e) => alive && setState({ status: isAppError(e) && e.kind === "not_found" ? "missing" : "error" }),
    );
    return () => {
      alive = false;
      if (held) blobCache.release(key);
    };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = state.status === "missing";
  useEffect(() => {
    if (!missing) return;
    return env.subscribe((names) => names.includes(key) && setTick((t) => t + 1));
  }, [missing, key, env]);
  return state;
}
