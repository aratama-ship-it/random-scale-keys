import test from "node:test";
import assert from "node:assert/strict";

import {
  accentForBeat,
  answerDegree,
  EFFECT_COUNTS,
  KEY_CODES,
  ROLE_COUNTS,
  chordForBar,
  chordRootMidi,
  chordForTension,
  chordToneWeight,
  createLayout,
  isResolution,
  noteLengthFromInterval,
  quantize,
  reverbSendFromSilence,
  sectionForBar,
  updateTension,
  velocityFromInterval,
} from "../gravity.mjs";

test("createLayout is deterministic for the same seed and changes for another seed", () => {
  assert.deepEqual(createLayout(123456, "daylight"), createLayout(123456, "daylight"));
  assert.notDeepEqual(createLayout(123456, "daylight"), createLayout(123457, "daylight"));
  assert.deepEqual(createLayout("fixed", "night"), createLayout("fixed", "night"));
});

test("createLayout assigns all keys with exact role and effect counts", () => {
  const layout = createLayout(42, "daylight");
  assert.deepEqual(Object.keys(layout.keys).sort(), [...KEY_CODES].sort());
  const count = (field) => Object.values(layout.keys).reduce((result, key) => {
    result[key[field]] = (result[key[field]] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(count("role"), ROLE_COUNTS);
  assert.deepEqual(count("effect"), EFFECT_COUNTS);
  for (const role of Object.keys(ROLE_COUNTS)) {
    const degreeCounts = Object.values(layout.keys)
      .filter((key) => key.role === role)
      .reduce((result, key) => ({ ...result, [key.degree]: (result[key.degree] ?? 0) + 1 }), {});
    const values = Object.values(degreeCounts);
    assert.ok(Math.max(...values) - Math.min(...values) <= 1);
  }
});

test("tension decays for eight beats before applying the role delta", () => {
  assert.equal(updateTension(0.5, 8, "stable"), 0);
  assert.ok(Math.abs(updateTension(0.5, 8, "floating") - (0.5 * Math.exp(-1) + 0.05)) < 1e-12);
  assert.ok(Math.abs(updateTension(0.5, 8, "tension") - (0.5 * Math.exp(-1) + 0.22)) < 1e-12);
});

test("chordForTension honors boundaries and alternates middle chords", () => {
  assert.equal(chordForTension("daylight", 0.29, 0), "I");
  assert.equal(chordForTension("daylight", 0.3, 0), "vi");
  assert.equal(chordForTension("daylight", 0.59, 1), "IV");
  assert.equal(chordForTension("daylight", 0.6, 1), "V");
  assert.equal(chordForTension("night", 0.3, 0), "VI");
  assert.equal(chordForTension("night", 0.3, 1), "iv");
  assert.equal(chordRootMidi("daylight", "I", 2), 36);
  assert.equal(chordRootMidi("night", "i", 2), 45);
});

test("quantize uses grace immediately and otherwise returns the next grid", () => {
  const start = 10;
  const grid = 0.15;
  assert.equal(quantize(start + grid + 0.02, start, 100), start + grid + 0.02);
  assert.ok(Math.abs(quantize(start + grid + 0.04, start, 100) - (start + grid * 2)) < 1e-12);
});

test("quantize snaps quarter and eighth note divisions to their next grid", () => {
  assert.ok(Math.abs(quantize(0.2, 0, 100, 1, 0.03) - 0.6) < 1e-12);
  assert.ok(Math.abs(quantize(0.2, 0, 100, 2, 0.03) - 0.3) < 1e-12);
});

test("velocity and length interpolation honor endpoints and midpoint", () => {
  assert.equal(velocityFromInterval(0.08), 0.5);
  assert.equal(velocityFromInterval(0.5), 1);
  assert.equal(velocityFromInterval(0.29), 0.75);
  assert.equal(noteLengthFromInterval(0.08), 0.12);
  assert.equal(noteLengthFromInterval(0.5), 0.5);
  assert.ok(Math.abs(noteLengthFromInterval(0.29) - 0.31) < 1e-12);
});

test("isResolution requires stable role, high previous T, and low next T", () => {
  assert.equal(isResolution(0.5, 0.24, "stable"), true);
  assert.equal(isResolution(0.49, 0.24, "stable"), false);
  assert.equal(isResolution(0.5, 0.25, "stable"), false);
  assert.equal(isResolution(0.5, 0.24, "floating"), false);
});

test("reverb send follows the silence curve and clamps", () => {
  assert.equal(reverbSendFromSilence(0), 0.2);
  assert.equal(reverbSendFromSilence(1), 0.2);
  assert.equal(reverbSendFromSilence(2.5), 0.5);
  assert.equal(reverbSendFromSilence(4), 0.8);
  assert.equal(reverbSendFromSilence(10), 0.8);
});

test("sectionForBar returns every v0.2 section at its boundaries", () => {
  assert.deepEqual(
    [0, 3, 4, 7, 8, 11, 12, 14, 15, 16].map(sectionForBar),
    ["intro", "intro", "a", "a", "b", "b", "outro", "outro", "outro-last", "end"],
  );
});

test("chordForBar applies each world loop and tension replacement rules", () => {
  assert.deepEqual([0, 1, 2, 3].map((bar) => chordForBar("daylight", bar, 0)), ["I", "I", "IV", "V"]);
  assert.deepEqual([0, 1, 2, 3].map((bar) => chordForBar("night", bar, 0)), ["i", "i", "VI", "VII"]);
  assert.equal(chordForBar("daylight", 1, 0.4), "vi");
  assert.equal(chordForBar("night", 1, 0.4), "iv");
  assert.deepEqual([0, 1, 2, 3].map((bar) => chordForBar("daylight", bar, 0.7)), ["V", "V", "V", "V"]);
  assert.deepEqual([0, 1, 2, 3].map((bar) => chordForBar("night", bar, 0.7)), ["VII", "VII", "VII", "VII"]);
});

test("accentForBeat creates strong, ordinary, and off-beat hierarchy", () => {
  assert.deepEqual(accentForBeat(0), { length: 1.6, gain: 1.15 });
  assert.deepEqual(accentForBeat(2), { length: 1.6, gain: 1.15 });
  assert.deepEqual(accentForBeat(1), { length: 1.2, gain: 1 });
  assert.deepEqual(accentForBeat(0.5), { length: 0.85, gain: 0.9 });
  assert.deepEqual(accentForBeat(0.25), { length: 0.85, gain: 0.9 });
});

test("answerDegree chooses the nearest chord degree with circular and lower tie breaks", () => {
  assert.equal(answerDegree("daylight", 7, "I"), 1);
  assert.equal(answerDegree("daylight", 4, "I"), 3);
});

test("chordToneWeight favors chord tones and shortens passing tones", () => {
  assert.deepEqual(chordToneWeight([1, 3, 5], 3), { length: 1, gain: 1.12 });
  assert.deepEqual(chordToneWeight([1, 3, 5], 2), { length: 0.8, gain: 0.8 });
});
