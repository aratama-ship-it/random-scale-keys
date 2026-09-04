import test from "node:test";
import assert from "node:assert/strict";

import { accompanimentPlan, partitionEventsByBar, scheduleRecordedTake } from "../render.js";
import { SCALES } from "../gravity.mjs";

test("partitionEventsByBar assigns boundary events exactly once, including the ending interval", () => {
  const events = [
    { id: "start", beat: 0 },
    { id: "before-first-boundary", beat: 3.999 },
    { id: "first-boundary", beat: 4 },
    { id: "before-ending", beat: 7.999 },
    { id: "ending", beat: 8 },
  ];

  const partitions = partitionEventsByBar(events, 2);

  assert.deepEqual(partitions.map((partition) => partition.map((event) => event.id)), [
    ["start", "before-first-boundary"],
    ["first-boundary", "before-ending"],
    ["ending"],
  ]);
  assert.deepEqual(partitions.flat(), events);
});

function sampleLog(bars = 2) {
  return {
    worldId: "daylight",
    scaleId: "ionian",
    bpm: 100,
    bars,
    events: [
      { kind: "press", beat: 2, time: 1.2, degree: 4, midi: 65, velocity: 0.8, length: 0.3, effect: "none", tAfter: 0.4 },
    ],
  };
}

function recordingSynth() {
  const calls = { lead: [], pad: [], bass: [] };
  return {
    beatSec: 0.6,
    calls,
    scheduleLead: (...args) => calls.lead.push(args),
    schedulePad: (...args) => calls.pad.push(args),
    scheduleBass: (...args) => calls.bass.push(args),
    scheduleKick: () => {},
    scheduleSnare: () => {},
    scheduleHat: () => {},
    scheduleResolution: () => {},
    scheduleEnding: () => {},
    setReverbSend: () => {},
  };
}

test("scheduleRecordedTake sends press and answer notes through the shared lead route", () => {
  const log = sampleLog();
  log.events.push({ kind: "answer", beat: 3, time: 1.8, degree: 1, midi: 60, velocity: 0.45, length: 0.6, effect: "none", tAfter: 0.4 });
  const synth = recordingSynth();
  scheduleRecordedTake({ currentTime: 0 }, synth, log, 0);
  assert.deepEqual(synth.calls.lead.map(([event]) => event.kind), ["press", "answer"]);
});

test("accompanimentPlan commits the next bar chord at the last eighth-note position deterministically", () => {
  const first = accompanimentPlan(sampleLog());
  const second = accompanimentPlan(sampleLog());
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.decisionBeat), [null, 3.5]);
  assert.equal(first[0].chordName, "I");
});

test("scheduleRecordedTake uses voiced pads and the three specified bass positions", () => {
  const synth = recordingSynth();
  scheduleRecordedTake({ currentTime: 0 }, synth, sampleLog(), 0);
  assert.equal(synth.calls.pad.length, 2);
  synth.calls.pad.forEach(([, , , , options]) => {
    assert.equal(options.voices.length, 3);
    assert.ok(options.voices.every((midi) => midi >= 55 && midi <= 79));
  });
  assert.deepEqual(synth.calls.bass.slice(0, 3).map(([midi, when, duration, gain]) => ({ midi, when, duration, gain })), [
    { midi: 36, when: 0, duration: 0.28, gain: 0.9 },
    { midi: 48, when: 1.2, duration: 0.28, gain: 0.75 },
    { midi: 47, when: 2.1, duration: 0.28, gain: 0.7 },
  ]);
});

test("section b restrikes the connected pad voices on beat three at reduced gain", () => {
  const synth = recordingSynth();
  scheduleRecordedTake({ currentTime: 0 }, synth, sampleLog(12), 0);
  const restrike = synth.calls.pad.find(([, when, duration, , options]) => (
    when === 34 * 0.6 && duration === 2 * 0.6 && options.gainScale === 0.6
  ));
  assert.ok(restrike);
});

test("all 21 scales produce a complete deterministic accompaniment schedule", () => {
  assert.equal(Object.keys(SCALES).length, 21);
  Object.keys(SCALES).forEach((scaleId) => {
    const log = { ...sampleLog(16), scaleId };
    const first = recordingSynth();
    const second = recordingSynth();
    assert.doesNotThrow(() => scheduleRecordedTake({ currentTime: 0 }, first, log, 0), scaleId);
    scheduleRecordedTake({ currentTime: 0 }, second, log, 0);
    first.calls.pad.forEach(([, , , , options]) => {
      assert.ok(options.voices.every((midi) => midi >= 55 && midi <= 79), scaleId);
    });
    assert.deepEqual(first.calls, second.calls, scaleId);
  });
});
