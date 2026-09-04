import test from "node:test";
import assert from "node:assert/strict";

import { createMidiFile, createMidiRecorder, midiVelocity, PPQ, secondsToTicks, vlq } from "../midi.js";

function sampleLog() {
  return {
    worldId: "daylight",
    seed: "abc123",
    bpm: 100,
    bars: 1,
    events: [
      { beat: 0, time: 0, kind: "press", midi: 60, length: 0.6, velocity: 0, effect: "none", tAfter: 0, resolution: false, section: "intro" },
      { beat: 1, time: 0.6, kind: "press", midi: 62, length: 0.1, velocity: 1, effect: "none", tAfter: 0, resolution: false, section: "intro" },
    ],
  };
}

function text(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function uint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

test("vlq encodes MIDI variable-length quantities", () => {
  assert.deepEqual(vlq(0), [0]);
  assert.deepEqual(vlq(127), [127]);
  assert.deepEqual(vlq(128), [0x81, 0x00]);
  assert.deepEqual(vlq(480), [0x83, 0x60]);
});

test("SMF header and all five track chunks have valid lengths and endings", () => {
  const bytes = createMidiFile(sampleLog());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(text(bytes, 0, 4), "MThd");
  assert.equal(view.getUint32(4), 6);
  assert.equal(view.getUint16(8), 1);
  assert.equal(view.getUint16(10), 5);
  assert.equal(view.getUint16(12), PPQ);

  let offset = 14;
  for (let track = 0; track < 5; track += 1) {
    assert.equal(text(bytes, offset, 4), "MTrk");
    const length = uint32(bytes, offset + 4);
    const end = offset + 8 + length;
    assert.deepEqual([...bytes.slice(end - 3, end)], [0xff, 0x2f, 0x00]);
    offset = end;
  }
  assert.equal(offset, bytes.length);
});

test("tempo track contains BPM tempo and 4/4 time-signature metadata", () => {
  const bytes = createMidiFile(sampleLog());
  const microseconds = Math.round(60_000_000 / 100);
  const tempo = [0xff, 0x51, 0x03, (microseconds >>> 16) & 0xff, (microseconds >>> 8) & 0xff, microseconds & 0xff];
  assert.notEqual(Buffer.from(bytes).indexOf(Buffer.from(tempo)), -1);
  assert.notEqual(Buffer.from(bytes).indexOf(Buffer.from([0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08])), -1);
});

test("time, velocity, and same-tick NoteOff ordering follow the contract", () => {
  assert.equal(secondsToTicks(0.6, 100), 480);
  assert.equal(midiVelocity(0), 1);
  assert.equal(midiVelocity(1), 127);
  const bytes = createMidiFile(sampleLog());
  const boundary = [0x83, 0x60, 0x80, 60, 0, 0, 0x90, 62, 127];
  assert.notEqual(Buffer.from(bytes).indexOf(Buffer.from(boundary)), -1);
});

test("recording synth expands lead effects and omits count-in clicks", () => {
  const recorder = createMidiRecorder({ worldId: "daylight", bpm: 100 });
  recorder.scheduleLead({ midi: 60 }, 0, 0.2, 0.5, "stutter");
  recorder.scheduleLead({ midi: 62 }, 1, 0.3, 0.75, "octave");
  recorder.scheduleClick(2, true);
  assert.deepEqual(recorder.tracks.lead.map(({ track, midi, when }) => ({ track, midi, when })), [
    { track: "lead", midi: 60, when: 0 },
    { track: "lead", midi: 60, when: 0.075 },
    { track: "lead", midi: 60, when: 0.15 },
    { track: "lead", midi: 62, when: 1 },
    { track: "lead", midi: 74, when: 1 },
  ]);
  assert.equal(recorder.tracks.drums.length, 0);
});

test("recording synth writes an arpeggio as three scale-degree triplet notes", () => {
  const recorder = createMidiRecorder({ worldId: "daylight", scaleId: "ionian", bpm: 100 });
  recorder.scheduleLead({ midi: 60, degree: 1 }, 0, 0.3, 0.8, "arpeggio");
  const beatSec = 60 / 100;
  assert.deepEqual(recorder.tracks.lead.map(({ midi, when, length, velocity }) => ({
    midi, when, length, velocity,
  })), [
    { midi: 60, when: 0, length: Math.max(0.12, (beatSec / 3) * 0.9), velocity: midiVelocity(0.8) },
    { midi: 64, when: beatSec / 3, length: Math.max(0.12, (beatSec / 3) * 0.9), velocity: midiVelocity(0.8 * 0.85) },
    { midi: 67, when: 2 * beatSec / 3, length: Math.max(0.12, (beatSec / 3) * 0.9), velocity: midiVelocity(0.8 * 0.75) },
  ]);
});
