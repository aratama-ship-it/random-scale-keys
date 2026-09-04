import test from "node:test";
import assert from "node:assert/strict";

import {
  ARPEGGIO_GAINS,
  accentForBeat,
  allocateKeys,
  answerDegree,
  arpeggioOffsets,
  approachDegree,
  EFFECT_COUNTS,
  KEY_CODES,
  ROLE_COUNTS,
  SCALES,
  chordDegreeNotes,
  chordDegrees,
  chordForBar,
  chordLabel,
  chordMidiNotes,
  chordRootInterval,
  chordRootMidi,
  chordSeventhInterval,
  chordForTension,
  chordToneWeight,
  chooseChord,
  createLayout,
  deriveRoles,
  getScale,
  harmonyScaleId,
  isResolution,
  noteMemory,
  noteLengthFromInterval,
  phraseRole,
  quantize,
  reverbSendFromSilence,
  sectionForBar,
  scoreChord,
  tonicChordForScale,
  updateTension,
  velocityFromInterval,
  voiceLead,
} from "../gravity.mjs";

test("createLayout is deterministic for the same seed and changes for another seed", () => {
  assert.deepEqual(createLayout(123456, "daylight"), createLayout(123456, "daylight"));
  assert.notDeepEqual(createLayout(123456, "daylight"), createLayout(123457, "daylight"));
  assert.deepEqual(createLayout("fixed", "night"), createLayout("fixed", "night"));
  assert.equal(createLayout(1, "daylight").scaleId, "ionian");
  assert.equal(createLayout(1, "night").scaleId, "aeolian");
});

test("createLayout assigns all keys with exact role and effect counts", () => {
  const layout = createLayout(42, "daylight");
  assert.equal(Object.values(EFFECT_COUNTS).reduce((sum, value) => sum + value, 0), 26);
  assert.deepEqual(Object.keys(layout.keys).sort(), [...KEY_CODES].sort());
  const count = (field) => Object.values(layout.keys).reduce((result, key) => {
    result[key[field]] = (result[key[field]] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(count("role"), allocateKeys(SCALES.ionian.roles));
  assert.deepEqual(count("effect"), EFFECT_COUNTS);
  for (const role of Object.keys(ROLE_COUNTS)) {
    const degreeCounts = Object.values(layout.keys)
      .filter((key) => key.role === role)
      .reduce((result, key) => ({ ...result, [key.degree]: (result[key.degree] ?? 0) + 1 }), {});
    const values = Object.values(degreeCounts);
    assert.ok(Math.max(...values) - Math.min(...values) <= 1);
  }
});

test("createLayout preserves the v0.9.0 degree, role, and octave sequence for seed 42", () => {
  const expected = {
    KeyA: [1, "stable", -1], KeyB: [5, "stable", 0], KeyC: [5, "stable", 0],
    KeyD: [2, "floating", -1], KeyE: [1, "stable", 0], KeyF: [6, "floating", 1],
    KeyG: [6, "floating", 1], KeyH: [3, "stable", 0], KeyI: [2, "floating", 0],
    KeyJ: [1, "stable", 1], KeyK: [7, "tension", 0], KeyL: [3, "stable", 1],
    KeyM: [2, "floating", 0], KeyN: [5, "stable", -1], KeyO: [6, "floating", -1],
    KeyP: [4, "tension", 0], KeyQ: [3, "stable", 0], KeyR: [7, "tension", 0],
    KeyS: [4, "tension", -1], KeyT: [1, "stable", 0], KeyU: [7, "tension", 0],
    KeyV: [5, "stable", -1], KeyW: [7, "tension", 1], KeyX: [4, "tension", 0],
    KeyY: [3, "stable", 1], KeyZ: [6, "floating", 0],
  };
  const actual = Object.fromEntries(Object.entries(createLayout(42, "daylight").keys)
    .map(([code, { degree, role, octave }]) => [code, [degree, role, octave]]));
  assert.deepEqual(actual, expected);
});

test("arpeggioOffsets follows scale degrees across octave boundaries", () => {
  assert.deepEqual(arpeggioOffsets("ionian", 1), [0, 4, 7]);
  assert.deepEqual(arpeggioOffsets("ionian", 5), [0, 4, 7]);
  assert.deepEqual(arpeggioOffsets("ionian", 7), [0, 3, 6]);
  assert.deepEqual(arpeggioOffsets("major_pentatonic", 1), [0, 4, 9]);
  assert.deepEqual(arpeggioOffsets("major_pentatonic", 5), [0, 5, 10]);
  assert.throws(() => arpeggioOffsets("ionian", 0), RangeError);
  assert.throws(() => arpeggioOffsets("ionian", 8), RangeError);
  assert.deepEqual(ARPEGGIO_GAINS, [1, 0.85, 0.75]);
});

test("tension decays for eight beats before applying the role delta", () => {
  assert.equal(updateTension(0.5, 8, "stable"), 0);
  assert.ok(Math.abs(updateTension(0.5, 8, "floating") - (0.5 * Math.exp(-1) + 0.05)) < 1e-12);
  assert.ok(Math.abs(updateTension(0.5, 8, "tension") - (0.5 * Math.exp(-1) + 0.22)) < 1e-12);
});

test("deriveRoles reproduces ionian and uses an interval-based tonic for major pentatonic", () => {
  assert.deepEqual(deriveRoles(SCALES.ionian.intervals), {
    stable: [1, 3, 5], floating: [2, 6], tension: [4, 7], gentle: false,
  });
  assert.deepEqual(deriveRoles(SCALES.major_pentatonic.intervals), {
    stable: [1, 3, 4], floating: [2, 5], tension: [], gentle: true,
  });
});

test("SCALES uses derived ionian roles and the explicit legacy aeolian roles", () => {
  const { gentle: _gentle, ...ionianRoles } = deriveRoles(SCALES.ionian.intervals);
  assert.deepEqual(SCALES.ionian.roles, ionianRoles);
  assert.deepEqual(SCALES.aeolian.roles, {
    stable: [1, 3, 5], floating: [2, 4], tension: [6, 7],
  });
  const { gentle: _aeolianGentle, ...derivedAeolianRoles } = deriveRoles(SCALES.aeolian.intervals);
  assert.notDeepEqual(SCALES.aeolian.roles, derivedAeolianRoles);
});

test("allocateKeys follows scale-degree proportions and always totals 26", () => {
  assert.deepEqual(allocateKeys(SCALES.ionian.roles), { stable: 12, floating: 7, tension: 7 });
  assert.deepEqual(allocateKeys(SCALES.major_pentatonic.roles), { stable: 16, floating: 10, tension: 0 });
  Object.values(SCALES).forEach((scale) => {
    assert.equal(Object.values(allocateKeys(scale.roles)).reduce((sum, count) => sum + count, 0), 26);
  });
});

test("gentle scales apply the larger floating tension increment", () => {
  assert.ok(Math.abs(updateTension(0.5, 8, "floating", "ionian") - (0.5 * Math.exp(-1) + 0.05)) < 1e-12);
  assert.ok(Math.abs(updateTension(0.5, 8, "floating", "major_pentatonic") - (0.5 * Math.exp(-1) + 0.12)) < 1e-12);
});

test("chordForTension honors boundaries and alternates middle chords", () => {
  assert.equal(chordForTension("daylight", 0.29, 0), "I");
  assert.equal(chordForTension("daylight", 0.3, 0), "vi");
  assert.equal(chordForTension("daylight", 0.59, 1), "IV");
  assert.equal(chordForTension("daylight", 0.6, 1), "V");
  assert.equal(chordForTension("night", 0.3, 0), "VI");
  assert.equal(chordForTension("night", 0.3, 1), "iv");
  assert.equal(chordRootMidi("daylight", "ionian", "I", 2), 36);
  assert.equal(chordRootMidi("night", "aeolian", "i", 2), 45);
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

test("chord degrees, labels, and section skeletons reproduce ionian and aeolian", () => {
  assert.deepEqual(chordDegrees("ionian"), { tonic: 1, subdominant: 4, dominant: 5, submediant: 6 });
  assert.deepEqual(chordDegrees("aeolian"), { tonic: 1, subdominant: 4, dominant: 7, submediant: 6 });
  assert.deepEqual([1, 4, 5, 6].map((degree) => chordLabel("ionian", degree)), ["I", "IV", "V", "vi"]);
  assert.deepEqual([1, 4, 7, 6].map((degree) => chordLabel("aeolian", degree)), ["i", "iv", "VII", "VI"]);
  const skeleton = (scaleId, section) => [0, 1, 2, 3].map((sectionBar) => chooseChord({
    scaleId, section, sectionBar, tension: 0.4, memory: {},
  }));
  assert.deepEqual(skeleton("ionian", "intro"), ["I", "I", "IV", "V"]);
  assert.deepEqual(skeleton("ionian", "a"), ["I", "I", "IV", "V"]);
  assert.deepEqual(skeleton("ionian", "b"), ["I", "vi", "IV", "V"]);
  assert.deepEqual(skeleton("ionian", "outro"), ["I", "IV", "V", "I"]);
  assert.deepEqual(skeleton("aeolian", "b"), ["i", "VI", "iv", "VII"]);
});

test("phraseRole identifies cadence, arrival, and free positions in skeleton v2", () => {
  ["intro", "a", "b"].forEach((section) => {
    assert.equal(phraseRole(section, 3), "cadence", section);
    assert.equal(phraseRole(section, 0), "arrival", section);
  });
  assert.equal(phraseRole("outro", 2), "cadence");
  assert.equal(phraseRole("outro", 0), "arrival");
  assert.equal(phraseRole("outro", 3), "arrival");
  assert.equal(phraseRole("a", 1), "free");
  assert.equal(phraseRole("outro-last", 3), "arrival");
});

test("harmonyScaleId maps the eight parent scales and leaves other scales unchanged", () => {
  assert.deepEqual(Object.fromEntries([
    "major_pentatonic", "minor_pentatonic", "blues", "yo",
    "egyptian", "in_sen", "hirajoshi", "ryukyu",
  ].map((scaleId) => [scaleId, harmonyScaleId(scaleId)])), {
    major_pentatonic: "ionian",
    minor_pentatonic: "aeolian",
    blues: "aeolian",
    yo: "ionian",
    egyptian: "dorian",
    in_sen: "phrygian",
    hirajoshi: "aeolian",
    ryukyu: "ionian",
  });
  assert.equal(harmonyScaleId("ionian"), "ionian");
  assert.equal(harmonyScaleId("whole_tone"), "whole_tone");
});

test("major pentatonic uses ionian triads and harmony function degrees", () => {
  const pitchClasses = (chord) => chordMidiNotes("daylight", "major_pentatonic", chord)
    .map((midi) => midi % 12);
  assert.deepEqual(pitchClasses("I"), [0, 4, 7]);
  assert.deepEqual(pitchClasses("IV"), [5, 9, 0]);
  assert.deepEqual(pitchClasses("V"), [7, 11, 2]);
  assert.deepEqual(pitchClasses("vi"), [9, 0, 4]);
  assert.deepEqual(chordDegrees("major_pentatonic"), {
    tonic: 1, subdominant: 4, dominant: 5, submediant: 6,
  });
  assert.equal(Array.from({ length: 7 }, (_, index) => chordLabel("major_pentatonic", index + 1))
    .some((label) => label.endsWith("*")), false);
});

test("in sen and hirajoshi use the specified parent-scale chord qualities", () => {
  assert.equal(tonicChordForScale("in_sen"), "i");
  assert.deepEqual(chordMidiNotes("daylight", "in_sen", "i").map((midi) => midi % 12), [0, 3, 7]);
  assert.deepEqual(chordMidiNotes("daylight", "in_sen", "iv").map((midi) => midi % 12), [5, 8, 0]);
  assert.equal(chordLabel("hirajoshi", chordDegrees("hirajoshi").dominant), "VII");
  assert.deepEqual(chordMidiNotes("daylight", "hirajoshi", "VII").map((midi) => midi % 12), [10, 2, 5]);
});

test("chordDegreeNotes bridges parent chords back to lead-scale degrees", () => {
  assert.deepEqual(chordDegreeNotes("major_pentatonic", "IV"), [1, 5]);
  assert.deepEqual(chordDegreeNotes("major_pentatonic", "vii°"), [2]);
});

test("parent-harmony roots and approach tones use harmony-scale semitones", () => {
  assert.equal(chordRootInterval("major_pentatonic", "V"), 7);
  assert.equal(approachDegree(0, getScale("ionian")), 11);
});

test("chordSeventhInterval returns the harmony-scale seventh above the chord root", () => {
  assert.equal(chordSeventhInterval("ionian", "V"), 5);
  assert.equal(chordSeventhInterval("aeolian", "VII"), 8);
});

test("major pentatonic chord scoring compares lead and chord pitch classes", () => {
  const ctx = { scaleId: "major_pentatonic", section: "b", sectionBar: 1, tension: 0.4, memory: { 5: 1 } };
  assert.ok(scoreChord(6, ctx) > scoreChord(4, ctx));
  assert.ok(scoreChord(6, ctx) > scoreChord(5, ctx));
});

test("all nine five- and six-note scales retain their specified interval-based lead roles", () => {
  const expected = {
    egyptian: { stable: [1, 2, 4], intervals: [0, 2, 7] },
    major_pentatonic: { stable: [1, 3, 4], intervals: [0, 4, 7] },
    minor_pentatonic: { stable: [1, 2, 4], intervals: [0, 3, 7] },
    yo: { stable: [1, 2, 4], intervals: [0, 2, 7] },
    in_sen: { stable: [1, 3, 4], intervals: [0, 5, 7] },
    hirajoshi: { stable: [1, 3, 4], intervals: [0, 3, 7] },
    ryukyu: { stable: [1, 2, 4], intervals: [0, 4, 7] },
    blues: { stable: [1, 2, 5], intervals: [0, 3, 7] },
    whole_tone: { stable: [1, 3, 5], intervals: [0, 4, 8] },
  };
  Object.entries(expected).forEach(([scaleId, values]) => {
    const scale = SCALES[scaleId];
    assert.deepEqual(scale.roles.stable, values.stable, scaleId);
    assert.deepEqual(values.stable.map((degree) => scale.intervals[degree - 1]), values.intervals, scaleId);
  });
});

test("short-scale chord choices use the shared section skeleton", () => {
  const rootForPosition = (sectionBar) => chordRootInterval("egyptian", chooseChord({
    scaleId: "egyptian", section: "a", sectionBar, tension: 0.4, memory: {},
  }));
  assert.deepEqual([0, 1, 2, 3].map(rootForPosition), [0, 0, 5, 10]);
});

test("all twelve seven-note scales retain their legacy chord degrees and tonic triad", () => {
  const sevenNoteScales = Object.values(SCALES).filter((scale) => scale.intervals.length >= 7);
  assert.equal(sevenNoteScales.length, 12);
  sevenNoteScales.forEach((scale) => {
    assert.deepEqual(chordDegreeNotes(scale.id, tonicChordForScale(scale.id)), [1, 3, 5], scale.id);
    assert.deepEqual(chordDegrees(scale.id), {
      tonic: 1,
      subdominant: 4,
      dominant: scale.intervals.at(-1) === 11 ? 5 : 7,
      submediant: 6,
    }, scale.id);
  });
});

test("egyptian stable degrees drive a complete 26-key allocation and tonic MIDI chord", () => {
  assert.deepEqual(SCALES.egyptian.roles.stable, [1, 2, 4]);
  assert.equal(Object.values(allocateKeys(SCALES.egyptian.roles)).reduce((sum, count) => sum + count, 0), 26);
  assert.deepEqual(chordMidiNotes("daylight", "egyptian", tonicChordForScale("egyptian")), [60, 63, 67]);
});

test("all 21 scales cover every lead degree and produce valid harmony chords for every degree", () => {
  assert.equal(Object.keys(SCALES).length, 21);
  Object.values(SCALES).forEach((scale) => {
    const assignedDegrees = Object.values(scale.roles).flat().sort((left, right) => left - right);
    assert.deepEqual(assignedDegrees, Array.from({ length: scale.intervals.length }, (_, index) => index + 1), scale.id);
    assert.equal(Object.values(allocateKeys(scale.roles)).reduce((sum, count) => sum + count, 0), 26, scale.id);
    assert.doesNotThrow(() => chooseChord({
      scaleId: scale.id, section: "a", sectionBar: 0, tension: 0.4, memory: {},
    }), scale.id);
    const harmonyDegreeCount = getScale(harmonyScaleId(scale.id)).intervals.length;
    for (let degree = 1; degree <= harmonyDegreeCount; degree += 1) {
      const chord = chordLabel(scale.id, degree);
      assert.equal(chordMidiNotes("daylight", scale.id, chord).length, 3, `${scale.id} ${degree}`);
    }
    assert.equal(Object.keys(createLayout(42, "daylight", scale.id).keys).length, 26, scale.id);
  });
});

test("accentForBeat creates strong, ordinary, and off-beat hierarchy", () => {
  assert.deepEqual(accentForBeat(0), { length: 1.6, gain: 1.15 });
  assert.deepEqual(accentForBeat(2), { length: 1.6, gain: 1.15 });
  assert.deepEqual(accentForBeat(1), { length: 1.2, gain: 1 });
  assert.deepEqual(accentForBeat(0.5), { length: 0.85, gain: 0.9 });
  assert.deepEqual(accentForBeat(0.25), { length: 0.85, gain: 0.9 });
});

test("answerDegree chooses the nearest chord degree with circular and lower tie breaks", () => {
  assert.equal(answerDegree("ionian", 7, "I"), 1);
  assert.equal(answerDegree("ionian", 4, "I"), 3);
});

test("chordToneWeight favors chord tones and shortens passing tones", () => {
  assert.deepEqual(chordToneWeight([1, 3, 5], 3), { length: 1, gain: 1.12 });
  assert.deepEqual(chordToneWeight([1, 3, 5], 2), { length: 0.8, gain: 0.8 });
});

test("noteMemory applies velocity decay and drops notes older than eight beats", () => {
  const memory = noteMemory([
    { kind: "press", beat: 4, degree: 1, velocity: 0.8 },
    { kind: "answer", beat: 0, degree: 3, velocity: 0.5 },
    { kind: "press", beat: -0.01, degree: 5, velocity: 1 },
    { kind: "release", beat: 7, degree: 7, velocity: 1 },
  ], 8);
  assert.ok(Math.abs(memory[1] - 0.8 * Math.exp(-1)) < 1e-12);
  assert.ok(Math.abs(memory[3] - 0.5 * Math.exp(-2)) < 1e-12);
  assert.equal(memory[5], undefined);
  assert.equal(memory[7], undefined);
});

test("scoreChord combines note fit with the section function bias", () => {
  const ctx = { scaleId: "ionian", section: "a", sectionBar: 0, tension: 0.4, memory: { 1: 2, 2: 1 } };
  assert.equal(scoreChord(1, ctx), 2.25);
  assert.equal(scoreChord(4, ctx), 1.5);
});

test("chooseChord follows memory over the skeleton when played notes strongly agree", () => {
  const base = { scaleId: "ionian", section: "a", sectionBar: 1, tension: 0.4 };
  assert.equal(chooseChord({ ...base, memory: {} }), "I");
  assert.equal(chooseChord({ ...base, memory: { 1: 1, 3: 1, 5: 1 } }), "I");
  assert.equal(chooseChord({ ...base, memory: { 1: 2, 4: 2, 6: 2 } }), "IV");
});

test("chooseChord repeat penalty breaks a constructed tie after two bars", () => {
  const ctx = {
    scaleId: "ionian", section: "a", sectionBar: 1, tension: 0.4, memory: { 4: 0.5 }, previousChord: "I",
  };
  assert.equal(scoreChord(1, { ...ctx, repeatCount: 1 }), scoreChord(4, { ...ctx, repeatCount: 1 }));
  assert.equal(chooseChord({ ...ctx, repeatCount: 1 }), "I");
  assert.notEqual(chooseChord({ ...ctx, repeatCount: 2 }), "I");
});

test("chooseChord favors dominant at high tension and forces tonic for resolution", () => {
  const ctx = { scaleId: "ionian", section: "a", sectionBar: 3, tension: 0.7, memory: {} };
  assert.equal(chooseChord(ctx), "V");
  assert.equal(chooseChord({ ...ctx, resolution: true }), "I");
});

test("chooseChord limits cadences and forces tonic arrivals despite note memory", () => {
  const cadence = chooseChord({
    scaleId: "ionian", section: "a", sectionBar: 3, tension: 0.4, memory: { 6: 100 },
  });
  assert.ok(["V", "IV"].includes(cadence));
  assert.notEqual(cadence, "vi");
  assert.equal(chooseChord({
    scaleId: "ionian", section: "b", sectionBar: 0, tension: 0.4, memory: { 4: 100 },
  }), "I");
});

test("approachDegree chooses the closest lower scale tone and falls back to the target", () => {
  assert.equal(approachDegree(7, SCALES.ionian), 5);
  assert.equal(approachDegree(6, [0]), 6);
});

test("voiceLead uses the nearest inversion inside the pad window", () => {
  assert.deepEqual(voiceLead(null, [5, 9, 0]), [65, 69, 72]);
  assert.deepEqual(voiceLead([60, 64, 67], [5, 9, 0]), [60, 65, 69]);
});

test("voiceLead rootPosition keeps the chord root in the lowest pad voice", () => {
  assert.deepEqual(voiceLead([60, 64, 67], [5, 9, 0], { rootPosition: true }), [65, 69, 72]);
});

test("chooseChord is deterministic for the same event log", () => {
  const events = [
    { kind: "press", beat: 1, degree: 4, velocity: 0.8 },
    { kind: "answer", beat: 2, degree: 6, velocity: 0.45 },
    { kind: "press", beat: 3, degree: 1, velocity: 0.7 },
  ];
  const sequence = () => [3.5, 7.5, 11.5].map((decisionBeat, index) => chooseChord({
    scaleId: "ionian",
    section: index === 0 ? "intro" : "a",
    sectionBar: index + 1,
    tension: 0.4,
    memory: noteMemory(events, decisionBeat),
  }));
  assert.deepEqual(sequence(), sequence());
});
