import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  diagnosticDisabledForState,
  fieldAt,
  formatParams,
  holdRelease,
  lerpColor,
  marchingSquares,
  nextTakeSettingsDisabledForState,
  parseParams,
  pressTracker,
  remainingSeconds,
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

test("next-take settings stay enabled while idle or finished and lock only during audio states", () => {
  assert.equal(nextTakeSettingsDisabledForState("idle"), false);
  assert.equal(nextTakeSettingsDisabledForState("finished"), false);
  assert.equal(nextTakeSettingsDisabledForState("countin"), true);
  assert.equal(nextTakeSettingsDisabledForState("playing"), true);
  assert.equal(nextTakeSettingsDisabledForState("replay"), true);
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
  assert.equal(transition("finished", "WORLD_CHANGE"), "finished");
  assert.equal(transition("finished", "SCALE_CHANGE"), "finished");
  assert.equal(transition("finished", "QUANTIZE_CHANGE"), "finished");
  assert.equal(transition("finished", "SEED_CHANGE"), "finished");
});

test("parseParams and formatParams round-trip and resolve unknown world or scale values", () => {
  const parsed = parseParams("?world=night&scale=hirajoshi&seed=abc");
  assert.deepEqual(parsed, { world: "night", scale: "hirajoshi", seed: "abc" });
  assert.deepEqual(parseParams(formatParams(parsed)), parsed);
  assert.deepEqual(parseParams("?world=space&scale=unknown&seed=42"), { world: "daylight", scale: "ionian", seed: "42" });
  assert.deepEqual(parseParams("?world=night&scale=unknown&seed=42"), { world: "night", scale: "aeolian", seed: "42" });
});

test("remainingSeconds is integral, clamps before start, and never becomes negative", () => {
  assert.equal(remainingSeconds(8, 10, 50.4), 41);
  assert.equal(remainingSeconds(27.1, 10, 50.4), 24);
  assert.equal(remainingSeconds(50.4, 10, 50.4), 0);
  assert.equal(remainingSeconds(60, 10, 50.4), 0);
});

test("holdRelease preserves natural length, follows a late release, and caps at the maximum", () => {
  assert.deepEqual(holdRelease(10, 0.5, 10.2, 16), { releaseAt: 10.5, length: 0.5, held: false });
  assert.deepEqual(holdRelease(10, 0.5, 12, 16), { releaseAt: 12, length: 2, held: true });
  assert.deepEqual(holdRelease(10, 0.5, 30, 16), { releaseAt: 26, length: 16, held: true });
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
    scaleId: "ionian",
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
  assert.match(validateTakeLog({ ...validTakeLog(), scaleId: "unknown" }).reason, /scaleId/);
  const legacy = validTakeLog();
  delete legacy.scaleId;
  assert.deepEqual(validateTakeLog(legacy), { ok: true });
});

test("validateTakeLog accepts SFX without note fields and rejects missing SFX fields", () => {
  const sfxLog = validTakeLog();
  sfxLog.events = [{ time: 0.6, beat: 1, kind: "sfx", code: "Digit4", sfx: "zap", variant: 0, velocity: 0.8 }];
  assert.deepEqual(validateTakeLog(sfxLog), { ok: true });
  const missingType = structuredClone(sfxLog);
  delete missingType.events[0].sfx;
  assert.match(validateTakeLog(missingType).reason, /必須項目/);
  const missingVariant = structuredClone(sfxLog);
  delete missingVariant.events[0].variant;
  assert.match(validateTakeLog(missingVariant).reason, /必須項目/);
});

test("validateTakeLog accepts optional timbre and held fields with their required types", () => {
  const log = validTakeLog();
  Object.assign(log.events[0], { timbre: "epiano", held: true });
  assert.deepEqual(validateTakeLog(log), { ok: true });
  const invalidTimbre = structuredClone(log);
  invalidTimbre.events[0].timbre = 3;
  assert.match(validateTakeLog(invalidTimbre).reason, /項目型/);
  const invalidHeld = structuredClone(log);
  invalidHeld.events[0].held = "yes";
  assert.match(validateTakeLog(invalidHeld).reason, /項目型/);
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

test("v0.12.0 waiting screen includes timbre controls, the performance tip, SFX legend, and cadence engine", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../main.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
  assert.match(html, /random-scale-keys v0\.12\.0/);
  assert.match(html, /id="timbre"/);
  assert.match(html, /id="timbre-shift"/);
  assert.match(main, /LEAD_TIMBRES\.map/);
  assert.match(main, /TIMBRE_LABELS\[timbre\]/);
  assert.match(html, /効果: dly \/ swp \/ oct \/ stt \/ arp \/ —/);
  assert.match(html, /SFX: 1-3 imp \/ 4-6 zap \/ 7-8 glt \/ 9-0 tape/);
  assert.match(main, /arpeggio: "arp"/);
  assert.match(main, /key\.className = "key key-sfx"/);
  assert.match(html, /コツ: 同じキー付近を続けて使うとループ感が出ます。展開したいときは使う位置を少しずつずらします。/);
  assert.match(main, /performanceTip\.hidden = state !== "idle"/);
  assert.match(main, /elements\.keyboard\.classList\.add\("shift"\)/);
  assert.match(css, /\.keyboard\.shift \.key:not\(\.key-sfx\).*var\(--text-sub\)/);
  assert.equal(main.match(/engine: "accomp-v4"/g)?.length, 2);
  assert.match(main, /beat % 16 === 0 && beat > 0\s*\? 1\s*:/);
});
