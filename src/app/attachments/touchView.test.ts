import assert from "node:assert/strict";
import { test } from "node:test";
import { IDENTITY, MAX_SCALE, clampPan, clampScale, doubleTap, pinch, settle, swipeOffset, swipeResult, zoomAround } from "./touchView.ts";

const vp = { w: 400, h: 800 };
const content = { w: 400, h: 300 };

test("scale stays within 1..5", () => {
  assert.equal(clampScale(0.4), 1);
  assert.equal(clampScale(9), MAX_SCALE);
  assert.equal(clampScale(2), 2);
});

test("a picture smaller than the screen on an axis stays centred on it", () => {
  const v = clampPan({ scale: 2, x: 500, y: 500 }, vp, content);
  // 400 * 2 = 800 wide on a 400 screen: up to 200 either way; 300 * 2 = 600 high on 800: centred
  assert.deepEqual(v, { scale: 2, x: 200, y: 0 });
  assert.deepEqual(clampPan({ scale: 1, x: 30, y: 30 }, vp, content), { scale: 1, x: 0, y: 0 });
});

test("zooming around a point keeps the point under the fingers", () => {
  const focus = { x: 100, y: 0 };
  const v = zoomAround(IDENTITY, 2, focus, vp, content);
  assert.equal(v.scale, 2);
  // the picture point at focus (100) is now at x*? : focus - (focus - 0) * 2 = -100
  assert.equal(v.x, -100);
});

test("pinch: spreading the fingers zooms, the midpoint carries the pan", () => {
  const v = pinch(IDENTITY, { x: -50, y: 0 }, { x: 50, y: 0 }, { x: -100, y: 0 }, { x: 100, y: 0 }, vp, content);
  assert.equal(v.scale, 2);
  assert.equal(v.x, 0);
  const moved = pinch(IDENTITY, { x: -50, y: 0 }, { x: 50, y: 0 }, { x: -50 - 40, y: 0 }, { x: 50 - 40, y: 0 }, vp, { w: 400, h: 800 });
  assert.equal(moved.scale, 1);
  assert.equal(moved.x, 0); // not zoomed: nothing to pan
});

test("pinch is clamped to 5 and a zero start distance does nothing", () => {
  const v = pinch(IDENTITY, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 500, y: 0 }, vp, content);
  assert.equal(v.scale, MAX_SCALE);
  assert.deepEqual(pinch(IDENTITY, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 80, y: 0 }, vp, content), IDENTITY);
});

test("settle snaps a nearly-1 scale back, otherwise re-clamps the pan", () => {
  assert.deepEqual(settle({ scale: 1.01, x: 9, y: 9 }, vp, content), IDENTITY);
  assert.deepEqual(settle({ scale: 2, x: 999, y: 0 }, vp, content), { scale: 2, x: 200, y: 0 });
});

test("double tap zooms in around the tap, and out again when zoomed", () => {
  const z = doubleTap(IDENTITY, { x: 0, y: 0 }, vp, content);
  assert.equal(z.scale, 2.5);
  assert.deepEqual(doubleTap(z, { x: 0, y: 0 }, vp, content), IDENTITY);
});

test("swipe: far or fast sideways steps, down closes, small stays", () => {
  assert.equal(swipeResult(-150, 10, 0, 0, 400), "next");
  assert.equal(swipeResult(150, -10, 0, 0, 400), "prev");
  assert.equal(swipeResult(-40, 0, -0.8, 0, 400), "next"); // a flick
  assert.equal(swipeResult(-20, 0, -0.9, 0, 400), "stay"); // too short even for a flick
  assert.equal(swipeResult(-60, 0, -0.1, 0, 400), "stay");
  assert.equal(swipeResult(10, 160, 0, 0.1, 400), "close");
  assert.equal(swipeResult(5, 60, 0, 0.9, 400), "close");
  assert.equal(swipeResult(5, 60, 0, 0.1, 400), "stay");
  assert.equal(swipeResult(0, -200, 0, -1, 400), "stay"); // up does nothing
});

test("the pull is cut to a third past the first and last picture", () => {
  assert.equal(swipeOffset(90, 0, 3), 30);
  assert.equal(swipeOffset(90, 1, 3), 90);
  assert.equal(swipeOffset(-90, 2, 3), -30);
  assert.equal(swipeOffset(-90, 0, 3), -90);
});
