import { test } from "node:test";
import assert from "node:assert/strict";
import { backdropSupported, glassStyle, GLASS_BLUR } from "./glass.ts";

test("glass_blurs_when_supported", () => {
  const s = glassStyle(true);
  assert.equal(GLASS_BLUR, 20);
  assert.equal(s.background, "var(--color-glass)");
  assert.match(String(s.backdropFilter), /blur\(20px\)/);
  assert.equal(s.WebkitBackdropFilter, s.backdropFilter);
});

test("glass_falls_back_to_opaque", () => {
  const s = glassStyle(false);
  assert.equal(s.background, "var(--color-glass-solid)");
  assert.equal(s.backdropFilter, undefined);
  assert.equal(s.WebkitBackdropFilter, undefined);
});

test("backdrop_support_checks_both_spellings", () => {
  const only = (prop: string) => ({ supports: (p: string) => p === prop });
  assert.equal(backdropSupported(only("backdrop-filter")), true);
  assert.equal(backdropSupported(only("-webkit-backdrop-filter")), true);
  assert.equal(backdropSupported(only("color")), false);
  assert.equal(backdropSupported(undefined), false);
});
