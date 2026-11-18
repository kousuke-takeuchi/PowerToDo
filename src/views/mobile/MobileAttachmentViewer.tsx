import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Share, X } from "lucide-react";
import { AttachmentEnvContext } from "../../app/attachments/env";
import { formatBytes, stepViewer } from "../../app/attachments/list";
import {
  IDENTITY,
  clampPan,
  doubleTap,
  pinch,
  settle,
  swipeOffset,
  swipeResult,
  type Pt,
  type Size,
  type View,
} from "../../app/attachments/touchView";
import { useEscLayer } from "../../app/layers";
import { useMotionTiming } from "../../motion";
import type { AttachmentInfo } from "../../types/model";
import { Picture } from "../AttachmentPicture";

/** Two taps this close in time (ms) and place (px) are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 28;
/** A finger that moved less than this (px) between down and up is a tap. */
const TAP_SLOP = 8;

type Gesture = {
  pts: Map<number, Pt>;
  /** The view and the finger position when the current one-finger drag, or the pinch, began. */
  startView: View;
  start: Pt | null;
  pinchStart: [Pt, Pt] | null;
  moved: boolean;
  pinched: boolean;
  /** Speed of the finger (px per ms), smoothed, for flicks. */
  vx: number;
  vy: number;
  last: { t: number; p: Pt } | null;
  lastTap: { t: number; p: Pt } | null;
};

const newGesture = (): Gesture => ({ pts: new Map(), startView: IDENTITY, start: null, pinchStart: null, moved: false, pinched: false, vx: 0, vy: 0, last: null, lastTap: null });

/**
 * Spec attachments §6: a picture full screen on black. Pinch zooms (up to 5x), a drag pans a zoomed picture, a double
 * tap zooms in and out, a swipe left / right steps among `files`, a swipe down or the x closes, a tap shows or hides the
 * buttons. The share button hands the file to the iOS preview (`env.open`), whose share sheet saves it to Files.
 * The maths is in `app/attachments/touchView.ts`.
 */
export function MobileAttachmentViewer({ files, index, onIndex, onClose }: { files: AttachmentInfo[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const env = useContext(AttachmentEnvContext);
  const { reduced } = useMotionTiming();
  useEscLayer(true, onClose);
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const g = useRef<Gesture>(newGesture());
  const tapTimer = useRef<number | undefined>(undefined);
  const [view, setView] = useState<View>(IDENTITY);
  const [pull, setPull] = useState<Pt>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [chrome, setChrome] = useState(true);
  const file = files[index];

  // A new picture starts unzoomed (the key on Picture makes a new img; the old one's size is stale until it loads).
  useEffect(() => {
    setView(IDENTITY);
    setPull({ x: 0, y: 0 });
    imgRef.current = null;
  }, [index]);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  const viewport = (): Size => {
    const r = rootRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 390, h: r?.height ?? 760 };
  };
  const content = (): Size => {
    const img = imgRef.current;
    return img && img.offsetWidth > 0 ? { w: img.offsetWidth, h: img.offsetHeight } : viewport();
  };
  const rel = (e: React.PointerEvent): Pt => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - ((r?.left ?? 0) + (r?.width ?? 0) / 2), y: e.clientY - ((r?.top ?? 0) + (r?.height ?? 0) / 2) };
  };

  const onDown = (e: React.PointerEvent) => {
    const s = g.current;
    const p = rel(e);
    s.pts.set(e.pointerId, p);
    rootRef.current?.setPointerCapture(e.pointerId);
    if (s.pts.size === 1) {
      s.start = p;
      s.startView = view;
      s.moved = false;
      s.pinched = false;
      s.vx = s.vy = 0;
      s.last = { t: e.timeStamp, p };
      setDragging(true);
    } else if (s.pts.size === 2) {
      const [a, b] = [...s.pts.values()];
      s.pinchStart = [a, b];
      s.startView = view;
      s.pinched = true;
      setPull({ x: 0, y: 0 });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s.pts.has(e.pointerId)) return;
    const p = rel(e);
    s.pts.set(e.pointerId, p);
    if (s.pts.size >= 2 && s.pinchStart) {
      const [a, b] = [...s.pts.values()];
      setView(pinch(s.startView, s.pinchStart[0], s.pinchStart[1], a, b, viewport(), content()));
      return;
    }
    if (!s.start || s.pinched) return;
    const dx = p.x - s.start.x;
    const dy = p.y - s.start.y;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) s.moved = true;
    if (s.last && e.timeStamp - s.last.t >= 16) {
      const dt = e.timeStamp - s.last.t;
      s.vx = 0.6 * s.vx + 0.4 * ((p.x - s.last.p.x) / dt);
      s.vy = 0.6 * s.vy + 0.4 * ((p.y - s.last.p.y) / dt);
      s.last = { t: e.timeStamp, p };
    }
    if (s.startView.scale > 1.02) {
      setView(clampPan({ scale: s.startView.scale, x: s.startView.x + dx, y: s.startView.y + dy }, viewport(), content()));
    } else if (Math.abs(dy) > Math.abs(dx)) {
      setPull({ x: 0, y: Math.max(0, dy) });
    } else {
      setPull({ x: swipeOffset(dx, index, files.length), y: 0 });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s.pts.has(e.pointerId)) return;
    const p = rel(e);
    const wasPinch = s.pts.size >= 2;
    s.pts.delete(e.pointerId);
    rootRef.current?.releasePointerCapture?.(e.pointerId);
    if (wasPinch) {
      // One finger stays down: it carries on as a pan from the settled view.
      const settled = settle(view, viewport(), content());
      setView(settled);
      s.pinchStart = null;
      const rest = [...s.pts.values()][0];
      if (rest) {
        s.start = rest;
        s.startView = settled;
        s.vx = s.vy = 0;
        s.last = null;
      }
      return;
    }
    setDragging(false);
    const start = s.start;
    s.start = null;
    if (!start || s.pinched || e.type === "pointercancel") {
      setPull({ x: 0, y: 0 });
      return;
    }
    if (!s.moved) {
      // A tap: twice zooms; once shows or hides the buttons (after waiting to see whether a second tap follows).
      const lt = s.lastTap;
      if (lt && e.timeStamp - lt.t < DOUBLE_TAP_MS && Math.hypot(p.x - lt.p.x, p.y - lt.p.y) < DOUBLE_TAP_PX) {
        window.clearTimeout(tapTimer.current);
        s.lastTap = null;
        setView((v) => doubleTap(v, p, viewport(), content()));
      } else {
        s.lastTap = { t: e.timeStamp, p };
        tapTimer.current = window.setTimeout(() => setChrome((c) => !c), DOUBLE_TAP_MS);
      }
      return;
    }
    if (s.startView.scale > 1.02) return; // a pan: the view is already where the finger left it
    const res = swipeResult(p.x - start.x, p.y - start.y, s.vx, s.vy, viewport().w);
    setPull({ x: 0, y: 0 });
    if (res === "close") onClose();
    else if (res === "next" || res === "prev") onIndex(stepViewer(index, res === "next" ? 1 : -1, files.length));
  };

  if (!file) return null;
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const roundButton = (label: string, node: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, border: 0, borderRadius: 22, background: "rgba(255,255,255,0.16)", color: "#fff", cursor: "pointer" }}
    >
      {node}
    </button>
  );
  const fade = Math.min(0.5, pull.y / 500);
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      data-touch-viewer=""
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ position: "fixed", inset: 0, zIndex: 1000, overflow: "hidden", display: "grid", placeItems: "center", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", background: `rgba(0,0,0,${0.94 - fade})`, fontFamily: "var(--font-body)" }}
    >
      <div
        style={{
          transform: `translate(${pull.x + view.x}px, ${pull.y + view.y}px) scale(${view.scale})`,
          transition: dragging || reduced ? "none" : "transform 160ms ease-out",
          willChange: "transform",
        }}
      >
        <Picture key={`${file.hash}.${file.ext}`} file={file} fit="screen" onShown={(img) => (imgRef.current = img)} />
      </div>
      {chrome && (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "calc(env(safe-area-inset-top, 0px) + 8px) 12px 0" }}>
            {roundButton("閉じる", <X size={20} />, onClose)}
            {roundButton("共有・ファイルに保存", <Share size={20} />, () => void env.open(file).catch(env.onError))}
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 16px calc(env(safe-area-inset-bottom, 0px) + 12px)", textAlign: "center", fontSize: 13, lineHeight: "19px", color: "rgba(255,255,255,0.85)", pointerEvents: "none", overflowWrap: "anywhere" }}>
            {`${file.name}  ${formatBytes(file.size)}${files.length > 1 ? `  (${index + 1} / ${files.length})` : ""}`}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
