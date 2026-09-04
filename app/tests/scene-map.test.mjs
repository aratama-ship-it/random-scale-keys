import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { midiForDegree } from "../../prototype/gravity.mjs";
import {
  assignDegrees,
  detectFormat,
  flightTimes,
  sceneToEvents,
} from "../scene-map.mjs";

const fixture = JSON.parse(await readFile(new URL("../scenes/three-ball-cascade.json", import.meta.url), "utf8"));

test("assignDegrees is deterministic and retains every prop beyond seven degrees", () => {
  const props = Array.from({ length: 10 }, (_, index) => `prop.${index}`);
  assert.deepEqual(assignDegrees(props, 42, "ionian"), assignDegrees(props, 42, "ionian"));
  assert.equal(Object.keys(assignDegrees(props.slice(0, 3), 42, "ionian")).length, 3);
  assert.deepEqual(Object.keys(assignDegrees(props, 42, "ionian")), props);
  assert.equal(new Set(Object.values(assignDegrees(props.slice(0, 7), 42, "ionian"))).size, 7);
});

test("flightTimes pairs releases and catches per prop, including an exact-loop boundary", () => {
  const flights = flightTimes(fixture);
  assert.equal(flights.length, 6);
  assert.deepEqual(new Set(flights.map((entry) => entry.propId)), new Set(["ball.A", "ball.B", "ball.C"]));
  flights.forEach((entry) => assert.ok(Math.abs(entry.flightSec - 0.6) < 1e-9));

  const input = structuredClone(fixture);
  input.events = [
    { id: "release-only", t: 0, type: "release", propId: "ball.A" },
    { id: "release-matched", t: 0.2, type: "release", propId: "ball.B" },
    { id: "catch-matched", t: 0.8, type: "catch", propId: "ball.B" },
  ];
  assert.deepEqual(flightTimes(input).map((entry) => entry.releaseId), ["release-matched"]);
});

test("sceneToEvents maps catches to presses, preserves releases only as log events, and applies hand octave", () => {
  const log = sceneToEvents(fixture, {
    worldId: "daylight",
    scaleId: "ionian",
    seed: 123,
    bpm: 100,
    bars: 1,
    quantize: { enabled: false, division: null },
  });
  const presses = log.events.filter((event) => event.kind === "press");
  const releases = log.events.filter((event) => event.kind === "release");
  assert.equal(presses.length, 7);
  assert.ok(releases.length > 0);
  releases.forEach((event) => {
    assert.equal(event.velocity, 0);
    assert.equal(event.length, 0);
  });
  log.events.forEach((event) => assert.equal(event.sourceId, "motion-scene"));

  const degrees = assignDegrees(fixture.props.map((prop) => prop.id), 123, "ionian");
  const right = presses.find((event) => event.propId === "ball.B" && event.sceneTime === 0.3);
  const left = presses.find((event) => event.propId === "ball.A" && event.sceneTime === 0.6);
  assert.equal(right.midi, midiForDegree("daylight", "ionian", degrees["ball.B"], 0));
  assert.equal(left.midi, midiForDegree("daylight", "ionian", degrees["ball.A"], -1));
  assert.equal(log.scaleId, "ionian");
  assert.equal(log.engine, "accomp-v2");
});

test("sceneToEvents loops to the take boundary without exceeding it", () => {
  const log = sceneToEvents(fixture, {
    worldId: "daylight",
    scaleId: "ionian",
    seed: 7,
    bpm: 100,
    bars: 16,
    quantize: { enabled: true, division: 2 },
  });
  assert.equal(16 * 4 * 60 / 100, 38.4);
  assert.ok(log.events.every((event) => event.time <= 38.4));
  const sceneLoops = new Set(log.events.filter((event) => "sceneLoop" in event).map((event) => event.sceneLoop));
  assert.equal(sceneLoops.size, 22);
  assert.equal(Math.max(...sceneLoops), 21);
  assert.equal(log.events.filter((event) => event.kind === "press").length, 127);
});

test("quantize setting uses the shared grid rule", () => {
  const off = sceneToEvents(fixture, {
    worldId: "night", scaleId: "aeolian", seed: 9, bpm: 88, bars: 1, quantize: { enabled: false, division: null },
  });
  const eighth = sceneToEvents(fixture, {
    worldId: "night", scaleId: "aeolian", seed: 9, bpm: 88, bars: 1, quantize: { enabled: true, division: 2 },
  });
  assert.equal(off.events.find((event) => event.kind === "press").time, 0.3);
  assert.notEqual(eighth.events.find((event) => event.kind === "press").time, 0.3);
});

test("detectFormat distinguishes take logs, Motion Scenes, and unknown objects", () => {
  assert.equal(detectFormat({ version: "gravity-v0" }), "gravity-v0");
  assert.equal(detectFormat({ format: "juggling-motion-scene" }), "juggling-motion-scene");
  assert.equal(detectFormat({ format: "other" }), "unknown");
});
