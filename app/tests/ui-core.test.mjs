import test from "node:test";
import assert from "node:assert/strict";

import { formatParams, lerpColor, parseParams, rowOffsetPx, transition } from "../ui-core.mjs";

test("lerpColor returns the endpoints and midpoint as uppercase HEX", () => {
  assert.equal(lerpColor("#F3EFE6", "#EAD9CC", 0), "#F3EFE6");
  assert.equal(lerpColor("#F3EFE6", "#EAD9CC", 1), "#EAD9CC");
  assert.equal(lerpColor("#F3EFE6", "#EAD9CC", 0.5), "#EFE4D9");
});

test("transition covers the four-state flow and leaves invalid events unchanged", () => {
  assert.equal(transition("idle", "START"), "countin");
  assert.equal(transition("countin", "COUNTIN_COMPLETE"), "playing");
  assert.equal(transition("playing", "TAKE_COMPLETE"), "finished");
  assert.equal(transition("finished", "RETAKE"), "countin");
  assert.equal(transition("finished", "REROLL"), "idle");
  assert.equal(transition("countin", "STOP"), "finished");
  assert.equal(transition("playing", "STOP"), "finished");
  assert.equal(transition("idle", "TAKE_COMPLETE"), "idle");
  assert.equal(transition("unknown", "START"), "unknown");
});

test("parseParams and formatParams round-trip and reject unknown worlds", () => {
  const parsed = parseParams("?world=night&seed=abc");
  assert.deepEqual(parsed, { world: "night", seed: "abc" });
  assert.deepEqual(parseParams(formatParams(parsed)), parsed);
  assert.deepEqual(parseParams("?world=space&seed=42"), { world: "daylight", seed: "42" });
});

test("rowOffsetPx preserves the physical row ratios", () => {
  assert.deepEqual([0, 1, 2].map((row) => rowOffsetPx(row, 64)), [0, 16, 40]);
  assert.deepEqual([0, 1, 2].map((row) => rowOffsetPx(row, 52)), [0, 13, 33]);
});
