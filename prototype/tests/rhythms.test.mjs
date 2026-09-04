import test from "node:test";
import assert from "node:assert/strict";

import {
  hatForStep,
  kickForStep,
  snareForStep,
} from "../gravity.mjs";
import {
  RHYTHMS,
  bpmForRhythm,
  drumHitsForStep,
  drumSwingSeconds,
} from "../rhythms.mjs";

const SECTIONS = ["intro", "a", "b", "outro"];
const TYPES = ["kick", "snare", "hatClosed", "hatOpen"];

test("pattern rhythms define four complete 16-step velocity rows", () => {
  assert.deepEqual(Object.keys(RHYTHMS), ["gravity", "disco", "dnb", "pops", "hiphop"]);
  Object.entries(RHYTHMS).forEach(([rhythmId, rhythm]) => {
    assert.ok(["rules", "pattern"].includes(rhythm.source), rhythmId);
    if (rhythm.source !== "pattern") return;
    SECTIONS.forEach((section) => {
      TYPES.forEach((type) => {
        const row = rhythm.pattern[section][type];
        assert.equal(row.length, 16, `${rhythmId} ${section} ${type}`);
        row.forEach((velocity) => assert.ok(velocity >= 0 && velocity <= 1, `${rhythmId} ${section} ${type}`));
      });
    });
  });
});

test("gravity drum hits exactly wrap the legacy rules", () => {
  ["intro", "a", "b", "outro", "outro-last", "end"].forEach((section) => {
    for (let step = 0; step < 16; step += 1) {
      [0.2, 0.4, 0.7].forEach((tension) => {
        const expected = [];
        if (kickForStep(section, step)) expected.push({ type: "kick", velocity: 1 });
        if (snareForStep(section, step)) expected.push({ type: "snare", velocity: 1 });
        if (section === "a" || section === "b") {
          const hat = hatForStep(tension, step);
          if (hat) expected.push({ type: hat === "open" ? "hatOpen" : "hatClosed", velocity: 1 });
        }
        assert.deepEqual(drumHitsForStep("gravity", section, step, tension), expected);
      });
    }
  });
});

test("disco has four-on-the-floor kicks and dnb snares include main and ghost hits", () => {
  const discoKicks = Array.from({ length: 16 }, (_, step) => drumHitsForStep("disco", "a", step, 0))
    .flatMap((hits, step) => hits.some(({ type }) => type === "kick") ? [step] : []);
  assert.deepEqual(discoKicks, [0, 4, 8, 12]);
  const dnbSnares = Array.from({ length: 16 }, (_, step) => drumHitsForStep("dnb", "a", step, 0))
    .flatMap((hits, step) => hits.filter(({ type }) => type === "snare").map(({ velocity }) => [step, velocity]));
  assert.deepEqual(dnbSnares, [[4, 1], [7, 0.35], [12, 1], [15, 0.35]]);
});

test("pattern tension adds open hats and hiphop swing delays odd sixteenths", () => {
  assert.equal(drumHitsForStep("pops", "a", 4, 0.59).some(({ type }) => type === "hatOpen"), false);
  assert.equal(drumHitsForStep("pops", "a", 4, 0.6).some(({ type }) => type === "hatOpen"), true);
  assert.equal(drumSwingSeconds("hiphop", "daylight", 7, 0.6), 0.6 / 4 * 0.12);
  assert.equal(drumSwingSeconds("hiphop", "daylight", 8, 0.6), 0);
  assert.equal(drumSwingSeconds("gravity", "daylight", 1, 0.6), 0.6 / 4 * 0.08);
  assert.equal(drumSwingSeconds("gravity", "night", 1, 0.6), 0);
});

test("rhythm BPM overrides the world only when specified", () => {
  assert.equal(bpmForRhythm("gravity", 88), 88);
  assert.equal(bpmForRhythm("disco", 88), 118);
  assert.equal(bpmForRhythm("dnb", 100), 172);
  assert.equal(bpmForRhythm("pops", 88), 100);
  assert.equal(bpmForRhythm("hiphop", 100), 90);
});
