import test from "node:test";
import assert from "node:assert/strict";

import {
  diagnosticDisabledForState,
  fieldAt,
  formatParams,
  lerpColor,
  marchingSquares,
  parseParams,
  pressTracker,
  roleElevation,
  rowOffsetPx,
  transition,
  validateTakeLog,
} from "../ui-core.mjs";

test("diagnostic controls are enabled only while idle or finished", () => {
  assert.equal(diagnosticDisabledForState("idle"), false);
  assert.equal(diagnosticDisabledForState("finished"), false);
  assert.equal(diagnosticDisabledForState("countin"), true);
  assert.equal(diagnosticDisabledForState("playing"), true);
  assert.equal(diagnosticDisabledForState("replay"), true);
});

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

test("roleElevation maps musical roles to terrain height", () => {
  assert.equal(roleElevation("tension"), 1);
  assert.equal(roleElevation("floating"), 0.3);
  assert.equal(roleElevation("stable"), -0.6);
  assert.equal(roleElevation("unknown"), 0);
});

test("fieldAt evaluates Gaussian sources at the center and one sigma away", () => {
  const sources = [{ x: 10, y: 20, elevation: 0.8 }];
  assert.equal(fieldAt(10, 20, sources, 12), 0.8);
  assert.ok(Math.abs(fieldAt(22, 20, sources, 12) - 0.8 * Math.exp(-0.5)) < 1e-12);
});

test("marchingSquares returns one crossing for a single high corner and none for a flat grid", () => {
  assert.equal(marchingSquares([1, 0, 0, 0], 2, 2, 0.5, 8).length, 1);
  assert.equal(marchingSquares([1, 1, 1, 1], 2, 2, 0.5, 8).length, 0);
});

test("marchingSquares omits near-zero cells unless a corner reaches the flat threshold", () => {
  const flat = [0.01, -0.01, -0.01, 0.01];
  const oneElevatedCorner = [0.1, -0.01, -0.01, -0.01];
  assert.equal(marchingSquares(flat, 2, 2, 0, 8, 0.04).length, 0);
  assert.deepEqual(
    marchingSquares(oneElevatedCorner, 2, 2, 0, 8, 0.04),
    marchingSquares(oneElevatedCorner, 2, 2, 0, 8),
  );
});

test("transition supports replay only from a finished take", () => {
  assert.equal(transition("finished", "REPLAY"), "replay");
  assert.equal(transition("replay", "REPLAY_END"), "finished");
  assert.equal(transition("finished", "REPLAY"), "replay");
  assert.equal(transition("replay", "STOP"), "finished");
  assert.equal(transition("idle", "REPLAY"), "idle");
});

function validTakeLog() {
  return {
    version: "gravity-v0",
    worldId: "daylight",
    seed: 42,
    bpm: 100,
    bars: 16,
    quantize: { enabled: true, division: 2 },
    events: [{ time: 0, beat: 0, kind: "press", midi: 60, degree: 1, role: "stable", velocity: 0.8, length: 0.5 }],
  };
}

test("validateTakeLog accepts the contract and explains rejected logs", () => {
  assert.deepEqual(validateTakeLog(validTakeLog()), { ok: true });
  assert.match(validateTakeLog({ ...validTakeLog(), version: "other" }).reason, /version/);
  assert.match(validateTakeLog({ ...validTakeLog(), events: undefined }).reason, /events/);
  assert.match(validateTakeLog({ ...validTakeLog(), worldId: "space" }).reason, /worldId/);
});

test("pressTracker retains the maximum after keys are released", () => {
  const tracker = pressTracker();
  tracker.add("KeyA");
  tracker.add("KeyB");
  tracker.add("KeyC");
  assert.equal(tracker.max, 3);
  assert.equal(tracker.remove("KeyB"), 2);
  assert.equal(tracker.current, 2);
  assert.equal(tracker.max, 3);
  assert.deepEqual(tracker.maxKeys, ["KeyA", "KeyB", "KeyC"]);
});
