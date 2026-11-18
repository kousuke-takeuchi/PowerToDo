/**
 * Spec attachments §6: the maths of the iPhone picture viewer (pinch to zoom, drag to pan, swipe to step or close).
 * Pure, so node --test covers it; the pointer handling is in `views/mobile/MobileAttachmentViewer.tsx`.
 * Coordinates are in px, measured from the centre of the viewport (the picture sits at the centre, scale 1).
 */

export interface View {
  scale: number;
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** What a double tap zooms to. */
export const DOUBLE_TAP_SCALE = 2.5;
export const IDENTITY: View = { scale: 1, x: 0, y: 0 };

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** The pan that keeps the zoomed picture covering the viewport (centred on an axis where it is smaller). */
export function clampPan(v: View, viewport: Size, content: Size): View {
  const limit = (view: number, c: number) => Math.max(0, (c * v.scale - view) / 2);
  const mx = limit(viewport.w, content.w);
  const my = limit(viewport.h, content.h);
  // `+ 0` turns -0 into 0
  return { scale: v.scale, x: Math.min(mx, Math.max(-mx, v.x)) + 0, y: Math.min(my, Math.max(-my, v.y)) + 0 };
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Zooms by `factor` around `focus` (a point relative to the viewport centre): the picture point under the fingers
 * stays under them. The scale is clamped, the pan is clamped to the picture.
 */
export function zoomAround(v: View, factor: number, focus: Pt, viewport: Size, content: Size): View {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return clampPan({ scale, x: focus.x - (focus.x - v.x) * k, y: focus.y - (focus.y - v.y) * k }, viewport, content);
}

/** A pinch from fingers at `a0`, `b0` to `a1`, `b1`, starting from view `start`. */
export function pinch(start: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt, viewport: Size, content: Size): View {
  const d0 = distance(a0, b0);
  if (d0 < 1) return start;
  const factor = distance(a1, b1) / d0;
  const scale = clampScale(start.scale * factor);
  const k = scale / start.scale;
  const m0 = midpoint(a0, b0);
  const m1 = midpoint(a1, b1);
  // The picture point that was under m0 ends under m1 (so the two fingers also pan).
  return clampPan({ scale, x: m1.x - (m0.x - start.x) * k, y: m1.y - (m0.y - start.y) * k }, viewport, content);
}

/** A pinch that ended a bit under 1 snaps to 1; the pan is re-clamped. */
export function settle(v: View, viewport: Size, content: Size): View {
  return v.scale <= 1.02 ? IDENTITY : clampPan(v, viewport, content);
}

/** A double tap at `focus`: back to 1 when zoomed, else to DOUBLE_TAP_SCALE around the tap. */
export function doubleTap(v: View, focus: Pt, viewport: Size, content: Size): View {
  if (v.scale > 1.02) return IDENTITY;
  return zoomAround(v, DOUBLE_TAP_SCALE, focus, viewport, content);
}

export type SwipeResult = "prev" | "next" | "close" | "stay";

/** Px a swipe must pass, as a share of the width, to step on its own (a flick steps with less). */
export const STEP_SHARE = 0.25;
/** Flick speed (px per ms) that steps or closes whatever the distance, once the finger has moved a little. */
export const FLICK_SPEED = 0.5;
export const CLOSE_DISTANCE = 120;

/**
 * What a one-finger swipe on an unzoomed picture means. `dx`, `dy`: how far the finger moved; `vx`, `vy`: its speed on release
 * (px per ms); `width`: the viewport width. Down mostly closes, left steps to the next picture, right to the previous.
 */
export function swipeResult(dx: number, dy: number, vx: number, vy: number, width: number): SwipeResult {
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > CLOSE_DISTANCE || (dy > 30 && vy > FLICK_SPEED) ? "close" : "stay";
  }
  const far = Math.abs(dx) > width * STEP_SHARE;
  const flick = Math.abs(dx) > 30 && Math.abs(vx) > FLICK_SPEED;
  if (!far && !flick) return "stay";
  return dx < 0 ? "next" : "prev";
}

/** The sideways pull of the picture while swiping: follows the finger, but only half as far past the first / last picture. */
export function swipeOffset(dx: number, index: number, count: number): number {
  const pastEdge = (dx > 0 && index === 0) || (dx < 0 && index >= count - 1);
  return pastEdge ? dx / 3 : dx;
}
