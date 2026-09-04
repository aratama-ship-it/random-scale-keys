export const KEY_CODES = Object.freeze(
  Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
);

export const EFFECT_COUNTS = Object.freeze({ none: 14, delay: 4, sweep: 3, octave: 3, stutter: 2 });

export const WORLDS = Object.freeze({
  daylight: Object.freeze({
    id: "daylight",
    label: "A: daylight",
    bpm: 100,
    rootMidi: 60,
    defaultScaleId: "ionian",
  }),
  night: Object.freeze({
    id: "night",
    label: "B: night",
    bpm: 88,
    rootMidi: 57,
    defaultScaleId: "aeolian",
  }),
});

const SCALE_DEFINITIONS = Object.freeze([
  ["ionian", "イオニアン（メジャー）", "教会旋法", [0, 2, 4, 5, 7, 9, 11]],
  ["dorian", "ドリアン", "教会旋法", [0, 2, 3, 5, 7, 9, 10]],
  ["phrygian", "フリジアン", "教会旋法", [0, 1, 3, 5, 7, 8, 10]],
  ["lydian", "リディアン", "教会旋法", [0, 2, 4, 6, 7, 9, 11]],
  ["mixolydian", "ミクソリディアン", "教会旋法", [0, 2, 4, 5, 7, 9, 10]],
  ["aeolian", "エオリアン（ナチュラル・マイナー）", "教会旋法", [0, 2, 3, 5, 7, 8, 10], {
    stable: [1, 3, 5],
    floating: [2, 4],
    tension: [6, 7],
  }],
  ["locrian", "ロクリアン", "教会旋法", [0, 1, 3, 5, 6, 8, 10]],
  ["harmonic_minor", "ハーモニック・マイナー", "短音階の変種", [0, 2, 3, 5, 7, 8, 11]],
  ["melodic_minor", "メロディック・マイナー", "短音階の変種", [0, 2, 3, 5, 7, 9, 11]],
  ["major_pentatonic", "メジャー・ペンタトニック", "五音音階・ブルース", [0, 2, 4, 7, 9]],
  ["minor_pentatonic", "マイナー・ペンタトニック", "五音音階・ブルース", [0, 3, 5, 7, 10]],
  ["blues", "ブルース", "五音音階・ブルース", [0, 3, 5, 6, 7, 10]],
  ["whole_tone", "ホールトーン", "五音音階・ブルース", [0, 2, 4, 6, 8, 10]],
  ["yo", "陽音階", "日本の音階", [0, 2, 5, 7, 9]],
  ["in_sen", "陰音階（都節）", "日本の音階", [0, 1, 5, 7, 8]],
  ["hirajoshi", "平調子", "日本の音階", [0, 2, 3, 7, 8]],
  ["ryukyu", "琉球音階", "日本の音階", [0, 4, 5, 7, 11]],
  ["hijaz", "ヒジャーズ", "その他の民族音階", [0, 1, 4, 5, 7, 8, 10]],
  ["hungarian_minor", "ハンガリアン・マイナー", "その他の民族音階", [0, 2, 3, 6, 7, 8, 11]],
  ["double_harmonic", "ダブル・ハーモニック", "その他の民族音階", [0, 1, 4, 5, 7, 8, 11]],
  ["egyptian", "エジプシャン", "その他の民族音階", [0, 2, 5, 7, 10]],
]);

const ROLE_ORDER = Object.freeze(["stable", "floating", "tension"]);
const ROLE_DELTA = Object.freeze({ stable: -0.3, floating: 0.05, tension: 0.22 });
const ROMAN_NUMERALS = Object.freeze(["I", "II", "III", "IV", "V", "VI", "VII"]);
export const HARMONY_PARENT = Object.freeze({
  major_pentatonic: "ionian",
  minor_pentatonic: "aeolian",
  blues: "aeolian",
  yo: "ionian",
  egyptian: "dorian",
  in_sen: "phrygian",
  hirajoshi: "aeolian",
  ryukyu: "ionian",
});
const FUNCTION_PATTERN = Object.freeze({
  intro: Object.freeze(["tonic", "tonic", "subdominant", "dominant"]),
  a: Object.freeze(["tonic", "tonic", "subdominant", "dominant"]),
  b: Object.freeze(["tonic", "submediant", "subdominant", "dominant"]),
  outro: Object.freeze(["tonic", "subdominant", "dominant", "tonic"]),
});
const PAD_MIDI_MIN = 55;
const PAD_MIDI_MAX = 79;
const PAD_MAX_SPAN = 16;

function frozenRoles(roles) {
  return Object.freeze(Object.fromEntries(
    ROLE_ORDER.map((role) => [role, Object.freeze([...roles[role]])]),
  ));
}

function closestDegree(intervals, targets, excludedDegrees = [], preferHigher = false) {
  const excluded = new Set(excludedDegrees);
  const candidates = intervals
    .map((interval, index) => ({
      degree: index + 1,
      interval,
      distance: Math.min(...targets.map((target) => Math.abs(interval - target))),
    }))
    .filter(({ degree }) => !excluded.has(degree));
  candidates.sort((left, right) => (
    left.distance - right.distance
    || (preferHigher ? right.interval - left.interval : left.interval - right.interval)
    || left.degree - right.degree
  ));
  if (!candidates.length) throw new RangeError("No scale degree is available");
  return candidates[0].degree;
}

function tonicDegrees(intervals) {
  if (intervals.length >= 7) return [1, 3, 5];
  const third = closestDegree(intervals, [3, 4], [1]);
  const fifth = closestDegree(intervals, [7], [1, third], true);
  return [1, third, fifth].sort((left, right) => left - right);
}

export function deriveRoles(intervals) {
  if (!Array.isArray(intervals) || intervals.length < 5) {
    throw new TypeError("intervals must contain at least five scale degrees");
  }
  const stable = tonicDegrees(intervals);
  const tonicTriad = new Set(stable.map((degree) => intervals[degree - 1]));
  const tension = [];
  const floating = [];
  intervals.forEach((interval, index) => {
    const degree = index + 1;
    if (stable.includes(degree)) return;
    const isSemitoneNeighbor = [...tonicTriad].some((triadInterval) => {
      const distance = ((interval - triadInterval) % 12 + 12) % 12;
      return distance === 1 || distance === 11;
    });
    (isSemitoneNeighbor ? tension : floating).push(degree);
  });
  return { stable, floating, tension, gentle: tension.length === 0 };
}

export const SCALES = Object.freeze(Object.fromEntries(SCALE_DEFINITIONS.map((definition) => {
  const [id, label, group, sourceIntervals, explicitRoles] = definition;
  const intervals = Object.freeze([...sourceIntervals]);
  const derived = deriveRoles(intervals);
  const roles = frozenRoles(explicitRoles ?? derived);
  return [id, Object.freeze({ id, label, group, intervals, roles, gentle: roles.tension.length === 0 })];
})));

export function allocateKeys(roles) {
  const countsByRole = Object.fromEntries(ROLE_ORDER.map((role) => [role, roles?.[role]?.length ?? 0]));
  const degreeCount = Object.values(countsByRole).reduce((total, count) => total + count, 0);
  if (degreeCount === 0) throw new RangeError("roles must contain at least one scale degree");
  const allocation = Object.fromEntries(ROLE_ORDER.map((role) => [
    role,
    Math.floor((KEY_CODES.length * countsByRole[role]) / degreeCount),
  ]));
  let remainder = KEY_CODES.length - Object.values(allocation).reduce((total, count) => total + count, 0);
  const recipients = ROLE_ORDER.filter((role) => countsByRole[role] > 0);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    allocation[recipients[index % recipients.length]] += 1;
  }
  return allocation;
}

export const ROLE_COUNTS = Object.freeze(allocateKeys(SCALES.ionian.roles));

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function expandedCounts(counts) {
  return Object.entries(counts).flatMap(([value, count]) => Array(count).fill(value));
}

function balancedDegrees(degrees, count, random) {
  if (count === 0) return [];
  if (degrees.length === 0) throw new RangeError("Cannot allocate keys to an empty role");
  const result = [];
  while (result.length + degrees.length <= count) {
    result.push(...shuffled(degrees, random));
  }
  result.push(...shuffled(degrees, random).slice(0, count - result.length));
  return shuffled(result, random);
}

export function getWorld(worldId) {
  const world = WORLDS[worldId];
  if (!world) throw new RangeError(`Unknown world: ${worldId}`);
  return world;
}

export function getScale(scaleId) {
  if (!Object.hasOwn(SCALES, scaleId)) throw new RangeError(`Unknown scale: ${scaleId}`);
  return SCALES[scaleId];
}

export function harmonyScaleId(scaleId) {
  getScale(scaleId);
  return HARMONY_PARENT[scaleId] ?? scaleId;
}

export function resolveScaleId(worldId, scaleId) {
  const world = getWorld(worldId);
  return Object.hasOwn(SCALES, scaleId) ? scaleId : world.defaultScaleId;
}

function scaleIdFromScaleOrWorld(scaleOrWorldId) {
  if (Object.hasOwn(SCALES, scaleOrWorldId)) return scaleOrWorldId;
  return getWorld(scaleOrWorldId).defaultScaleId;
}

export function roleForDegree(scaleId, degree) {
  const scale = getScale(scaleId);
  const entry = Object.entries(scale.roles).find(([, degrees]) => degrees.includes(degree));
  if (!entry) throw new RangeError(`Invalid scale degree: ${degree}`);
  return entry[0];
}

export function midiForDegree(worldId, scaleId, degree, octave = 0) {
  const world = getWorld(worldId);
  const scale = getScale(scaleId);
  if (!Number.isInteger(degree) || degree < 1 || degree > scale.intervals.length) {
    throw new RangeError(`Invalid scale degree: ${degree}`);
  }
  return world.rootMidi + scale.intervals[degree - 1] + octave * 12;
}

function triadForDegree(scaleId, degree) {
  const scale = getScale(harmonyScaleId(scaleId));
  const count = scale.intervals.length;
  if (!Number.isInteger(degree) || degree < 1 || degree > count) {
    throw new RangeError(`Invalid scale degree: ${degree}`);
  }
  const offsets = [0, 2, 4];
  return {
    degrees: offsets.map((offset) => ((degree - 1 + offset) % count) + 1),
    intervals: offsets.map((offset) => {
      const index = degree - 1 + offset;
      return scale.intervals[index % count] + 12 * Math.floor(index / count);
    }),
  };
}

export function chordLabel(scaleId, degree) {
  const { intervals } = triadForDegree(scaleId, degree);
  const quality = [0, intervals[1] - intervals[0], intervals[2] - intervals[0]].join(",");
  const roman = ROMAN_NUMERALS[degree - 1];
  if (quality === "0,4,7") return roman;
  if (quality === "0,3,7") return roman.toLowerCase();
  if (quality === "0,3,6") return `${roman.toLowerCase()}°`;
  if (quality === "0,4,8") return `${roman}+`;
  return `${roman}*`;
}

function degreeForChordLabel(scaleId, label) {
  const scale = getScale(harmonyScaleId(scaleId));
  const degree = Array.from({ length: scale.intervals.length }, (_, index) => index + 1)
    .find((candidate) => chordLabel(scaleId, candidate) === label);
  if (!degree) throw new RangeError(`Unknown chord ${label} for ${scaleId}`);
  return degree;
}

function chordPitchClasses(scaleId, degree, tonicPitchClass = 0) {
  return triadForDegree(scaleId, degree).intervals
    .map((interval) => ((tonicPitchClass + interval) % 12 + 12) % 12);
}

function permutations(values) {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]));
}

function pitchesForClass(pitchClass) {
  const pitches = [];
  for (let midi = pitchClass; midi <= PAD_MIDI_MAX; midi += 12) {
    if (midi >= PAD_MIDI_MIN) pitches.push(midi);
  }
  return pitches;
}

export function voiceLead(previousVoices, chordSemitones, options = {}) {
  const pitchClasses = [...chordSemitones].map((value) => ((value % 12) + 12) % 12);
  if (pitchClasses.length !== 3 || new Set(pitchClasses).size !== 3) {
    throw new TypeError("chordSemitones must contain three distinct pitches");
  }
  if (!previousVoices?.length) {
    const voices = [];
    pitchClasses.forEach((pitchClass) => {
      let midi = pitchClass;
      while (midi < PAD_MIDI_MIN || (voices.length && midi <= voices.at(-1))) midi += 12;
      voices.push(midi);
    });
    if (voices.at(-1) - voices[0] > PAD_MAX_SPAN) {
      voices[voices.length - 1] -= 12;
      voices.sort((left, right) => left - right);
    }
    return voices;
  }
  if (previousVoices.length !== 3) throw new TypeError("previousVoices must contain three pitches");

  const candidates = [];
  permutations(pitchClasses).forEach((orderedClasses) => {
    pitchesForClass(orderedClasses[0]).forEach((low) => {
      pitchesForClass(orderedClasses[1]).forEach((middle) => {
        pitchesForClass(orderedClasses[2]).forEach((high) => {
          if (!(low < middle && middle < high) || high - low > PAD_MAX_SPAN) return;
          const voices = [low, middle, high];
          const movement = voices.reduce((sum, midi, index) => sum + Math.abs(midi - previousVoices[index]), 0);
          candidates.push({ voices, movement });
        });
      });
    });
  });
  const rootPitchClass = pitchClasses[0];
  const rootPositionCandidates = options.rootPosition
    ? candidates.filter(({ voices }) => voices[0] % 12 === rootPitchClass)
    : [];
  const rankedCandidates = rootPositionCandidates.length ? rootPositionCandidates : candidates;
  rankedCandidates.sort((left, right) => (
    left.movement - right.movement
    || left.voices[0] - right.voices[0]
    || left.voices[1] - right.voices[1]
    || left.voices[2] - right.voices[2]
  ));
  if (!rankedCandidates.length) throw new RangeError("No pad voicing fits the MIDI window");
  return rankedCandidates[0].voices;
}

export function noteMemory(events, decisionBeat) {
  if (!Array.isArray(events) || !Number.isFinite(decisionBeat)) {
    throw new TypeError("events and a finite decisionBeat are required");
  }
  const memory = {};
  events.forEach((event) => {
    if (event.kind !== "press" && event.kind !== "answer") return;
    const deltaBeats = decisionBeat - event.beat;
    if (!Number.isFinite(deltaBeats) || deltaBeats < 0 || deltaBeats > 8) return;
    if (!Number.isInteger(event.degree) || !Number.isFinite(event.velocity)) return;
    const weight = event.velocity * Math.exp(-deltaBeats / 4);
    memory[event.degree] = (memory[event.degree] ?? 0) + weight;
  });
  return memory;
}

function normalizedSection(section) {
  return section === "outro-last" ? "outro" : section;
}

function functionForPosition(section, sectionBar) {
  const pattern = FUNCTION_PATTERN[normalizedSection(section)];
  if (!pattern) throw new RangeError(`Unknown section: ${section}`);
  return pattern[((sectionBar % 4) + 4) % 4];
}

export function phraseRole(section, sectionBar) {
  const normalized = normalizedSection(section);
  const position = ((sectionBar % 4) + 4) % 4;
  const targetFunction = functionForPosition(normalized, position);
  if (targetFunction === "dominant") return "cadence";
  if (position === 0 || (normalized === "outro" && position === 3)) return "arrival";
  return "free";
}

export function scoreChord(candidateDegree, ctx) {
  const scaleId = scaleIdFromScaleOrWorld(ctx.scaleId ?? ctx.worldId);
  const leadScale = getScale(scaleId);
  const harmonyScale = getScale(harmonyScaleId(scaleId));
  if (!Number.isInteger(candidateDegree) || candidateDegree < 1 || candidateDegree > harmonyScale.intervals.length) {
    throw new RangeError(`Invalid chord degree: ${candidateDegree}`);
  }
  const functions = chordDegrees(scaleId);
  const targetFunction = functionForPosition(ctx.section, ctx.sectionBar ?? ctx.barIndex ?? 0);
  const chordPitchClassSet = new Set(chordPitchClasses(scaleId, candidateDegree));
  const memory = ctx.memory ?? noteMemory(ctx.events ?? [], ctx.decisionBeat ?? 0);
  const fit = Object.entries(memory).reduce((sum, [degree, weight]) => {
    const pitchClass = leadScale.intervals[Number(degree) - 1] % 12;
    return sum + weight * (chordPitchClassSet.has(pitchClass) ? 1 : -0.5);
  }, 0);
  const functionBias = (candidateDegree === functions[targetFunction] ? 0.6 : 0)
    + (candidateDegree === functions.tonic ? 0.15 : 0);
  const tonicPitchClass = ctx.tonicPitchClass ?? 0;
  const nextVoices = ctx.previousVoices
    ? voiceLead(ctx.previousVoices, chordPitchClasses(scaleId, candidateDegree, tonicPitchClass))
    : null;
  const voiceLeading = nextVoices
    ? -0.04 * nextVoices.reduce((sum, midi, index) => sum + Math.abs(midi - ctx.previousVoices[index]), 0)
    : 0;
  const previousDegree = ctx.previousDegree
    ?? (ctx.previousChord ? degreeForChordLabel(scaleId, ctx.previousChord) : null);
  const repeatPenalty = candidateDegree === previousDegree && (ctx.repeatCount ?? 0) >= 2 ? -0.5 : 0;
  const tensionBias = ctx.tension >= 0.6 && candidateDegree === functions.dominant
    ? 0.5
    : (ctx.tension < 0.3 && candidateDegree === functions.tonic ? 0.2 : 0);
  return fit + functionBias + voiceLeading + repeatPenalty + tensionBias;
}

export function chooseChord(ctx) {
  const scaleId = scaleIdFromScaleOrWorld(ctx.scaleId ?? ctx.worldId);
  if (ctx.resolution) return tonicChordForScale(scaleId);
  const role = phraseRole(ctx.section, ctx.sectionBar ?? ctx.barIndex ?? 0);
  const functions = chordDegrees(scaleId);
  if (role === "arrival") return chordLabel(scaleId, functions.tonic);
  const candidates = role === "cadence"
    ? [...new Set([functions.dominant, functions.subdominant])]
    : Array.from({ length: getScale(harmonyScaleId(scaleId)).intervals.length }, (_, index) => index + 1);
  candidates.sort((left, right) => scoreChord(right, ctx) - scoreChord(left, ctx) || left - right);
  return chordLabel(scaleId, candidates[0]);
}

export function approachDegree(nextRootSemitone, scale) {
  const intervals = Array.isArray(scale) ? scale : scale?.intervals;
  if (!Number.isFinite(nextRootSemitone) || !Array.isArray(intervals)) {
    throw new TypeError("nextRootSemitone and scale intervals are required");
  }
  const nearby = [];
  intervals.forEach((interval) => {
    for (let octave = -2; octave <= 2; octave += 1) {
      const semitone = interval + octave * 12;
      const difference = semitone - nextRootSemitone;
      if (Math.abs(difference) >= 1 && Math.abs(difference) <= 2) {
        nearby.push({ interval, difference });
      }
    }
  });
  nearby.sort((left, right) => (
    Math.abs(left.difference) - Math.abs(right.difference)
    || (left.difference < 0 ? -1 : 1) - (right.difference < 0 ? -1 : 1)
    || left.interval - right.interval
  ));
  return nearby.length ? nearby[0].interval : ((nextRootSemitone % 12) + 12) % 12;
}

export function chordDegreeNotes(scaleId, chordName) {
  const chordPitchClassSet = new Set(chordPitchClasses(scaleId, degreeForChordLabel(scaleId, chordName)));
  const degrees = getScale(scaleId).intervals
    .map((interval, index) => ({ degree: index + 1, pitchClass: interval % 12 }))
    .filter(({ pitchClass }) => chordPitchClassSet.has(pitchClass))
    .map(({ degree }) => degree);
  return degrees.length ? degrees : [1];
}

export function chordMidiNotes(worldId, scaleId, chordName, octave = 0) {
  const world = getWorld(worldId);
  return triadForDegree(scaleId, degreeForChordLabel(scaleId, chordName)).intervals
    .map((interval) => world.rootMidi + interval + octave * 12);
}

export function chordRootInterval(scaleId, chordName) {
  const degree = degreeForChordLabel(scaleId, chordName);
  return triadForDegree(scaleId, degree).intervals[0] % 12;
}

export function chordSeventhInterval(scaleId, chordName) {
  const scale = getScale(harmonyScaleId(scaleId));
  const rootDegree = degreeForChordLabel(scaleId, chordName);
  const seventhOffset = scale.intervals.length >= 7 ? 6 : 5;
  const seventhIndex = rootDegree - 1 + seventhOffset;
  return scale.intervals[seventhIndex % scale.intervals.length] % 12;
}

export function chordRootMidi(worldId, scaleId, chordName, octaveNumber = 2) {
  const pitchClass = (getWorld(worldId).rootMidi + chordRootInterval(scaleId, chordName)) % 12;
  return (octaveNumber + 1) * 12 + pitchClass;
}

export function createLayout(seed, worldId, requestedScaleId) {
  const normalizedSeed = hashSeed(seed);
  const random = mulberry32(normalizedSeed);
  const world = getWorld(worldId);
  const scaleId = resolveScaleId(worldId, requestedScaleId);
  const scale = getScale(scaleId);
  const roleCounts = allocateKeys(scale.roles);
  const roles = shuffled(expandedCounts(roleCounts), random);
  const effects = shuffled(expandedCounts(EFFECT_COUNTS), random);
  const degreesByRole = Object.fromEntries(
    Object.entries(roleCounts).map(([role, count]) => [
      role,
      balancedDegrees(scale.roles[role], count, random),
    ]),
  );
  const roleOffsets = { stable: 0, floating: 0, tension: 0 };
  const keys = {};

  KEY_CODES.forEach((code, index) => {
    const role = roles[index];
    const degree = degreesByRole[role][roleOffsets[role]++];
    const octaveRoll = random();
    const octave = octaveRoll < 0.5 ? 0 : octaveRoll < 0.75 ? -1 : 1;
    keys[code] = {
      degree,
      octave,
      midi: midiForDegree(worldId, scaleId, degree, octave),
      role,
      effect: effects[index],
    };
  });

  return { seed: normalizedSeed, worldId: world.id, scaleId, keys };
}

export function decayTension(tension, deltaBeats) {
  return clamp(tension * Math.exp(-Math.max(0, deltaBeats) / 8));
}

export function updateTension(tension, deltaBeats, role, scaleId) {
  if (!(role in ROLE_DELTA)) throw new RangeError(`Unknown role: ${role}`);
  const floatingDelta = scaleId && getScale(scaleId).gentle ? 0.12 : ROLE_DELTA.floating;
  const delta = role === "floating" ? floatingDelta : ROLE_DELTA[role];
  return clamp(decayTension(tension, deltaBeats) + delta);
}

export function isResolution(previousTension, nextTension, role) {
  return role === "stable" && previousTension >= 0.5 && nextTension < 0.25;
}

export function tonicChordForScale(scaleId) {
  return chordLabel(scaleId, 1);
}

export function tonicChordForWorld(worldId) {
  return tonicChordForScale(getWorld(worldId).defaultScaleId);
}

export function chordDegrees(scaleOrWorldId) {
  const scaleId = scaleIdFromScaleOrWorld(scaleOrWorldId);
  const scale = getScale(harmonyScaleId(scaleId));
  const count = scale.intervals.length;
  if (count >= 7) {
    return {
      tonic: 1,
      subdominant: 4,
      dominant: scale.intervals[count - 1] === 11 ? 5 : count,
      submediant: 6,
    };
  }
  const subdominant = closestDegree(scale.intervals, [5], [1]);
  const dominant = closestDegree(scale.intervals, [7], [1, subdominant]);
  const submediant = closestDegree(scale.intervals, [9], [1, subdominant, dominant]);
  return { tonic: 1, subdominant, dominant, submediant };
}

export function chordForTension(scaleOrWorldId, tension, barIndex = 0) {
  const scaleId = scaleIdFromScaleOrWorld(scaleOrWorldId);
  const degrees = chordDegrees(scaleId);
  const tonic = chordLabel(scaleId, degrees.tonic);
  if (tension < 0.3) return tonic;
  if (tension < 0.6) {
    const degree = barIndex % 2 === 0 ? degrees.submediant : degrees.subdominant;
    return chordLabel(scaleId, degree);
  }
  return chordLabel(scaleId, degrees.dominant);
}

export function sectionForBar(barIndex) {
  if (!Number.isInteger(barIndex) || barIndex < 0) {
    throw new RangeError(`Invalid bar index: ${barIndex}`);
  }
  if (barIndex < 4) return "intro";
  if (barIndex < 8) return "a";
  if (barIndex < 12) return "b";
  if (barIndex < 15) return "outro";
  if (barIndex === 15) return "outro-last";
  return "end";
}

export function chordForBar(scaleOrWorldId, barIndex, tension) {
  const scaleId = scaleIdFromScaleOrWorld(scaleOrWorldId);
  if (!Number.isInteger(barIndex) || barIndex < 0) {
    throw new RangeError(`Invalid bar index: ${barIndex}`);
  }
  const scale = getScale(harmonyScaleId(scaleId));
  const degrees = chordDegrees(scaleId);
  const position = barIndex % 4;
  if (scale.intervals.length < 7) {
    if (tension >= 0.6) return chordLabel(scaleId, degrees.dominant);
    if (tension >= 0.3 && position === 1) return chordLabel(scaleId, degrees.subdominant);
    const loopDegrees = [degrees.tonic, degrees.tonic, degrees.submediant, degrees.dominant];
    return chordLabel(scaleId, loopDegrees[position]);
  }
  const tonicIntervals = triadForDegree(scaleId, degrees.tonic).intervals;
  const tonicQuality = [
    tonicIntervals[1] - tonicIntervals[0],
    tonicIntervals[2] - tonicIntervals[0],
  ];
  const isMinor = tonicQuality[0] === 3 && tonicQuality[1] === 7;
  const middleDegree = isMinor ? degrees.subdominant : degrees.submediant;
  const baseThirdDegree = isMinor ? degrees.submediant : degrees.subdominant;
  const loopDegrees = [degrees.tonic, degrees.tonic, baseThirdDegree, degrees.dominant];
  if (tension >= 0.6) return chordLabel(scaleId, degrees.dominant);
  if (tension >= 0.3 && tension < 0.6 && position === 1) {
    return chordLabel(scaleId, middleDegree);
  }
  return chordLabel(scaleId, loopDegrees[position]);
}

export function accentForBeat(beatInBar) {
  if (!Number.isFinite(beatInBar)) throw new RangeError(`Invalid beat: ${beatInBar}`);
  const normalized = ((beatInBar % 4) + 4) % 4;
  const onBeat = Math.abs(normalized - Math.round(normalized)) < 1e-9;
  if (!onBeat) return { length: 0.85, gain: 0.9 };
  const beat = Math.round(normalized) % 4;
  return beat === 0 || beat === 2
    ? { length: 1.6, gain: 1.15 }
    : { length: 1.2, gain: 1 };
}

export function answerDegree(scaleOrWorldId, lastDegree, chordName) {
  const scaleId = scaleIdFromScaleOrWorld(scaleOrWorldId);
  const scale = getScale(scaleId);
  const degrees = chordDegreeNotes(scaleId, chordName);
  if (!Number.isInteger(lastDegree) || lastDegree < 1 || lastDegree > scale.intervals.length) {
    throw new RangeError(`Invalid scale degree: ${lastDegree}`);
  }
  const distance = (degree) => {
    const direct = Math.abs(degree - lastDegree);
    return Math.min(direct, scale.intervals.length - direct);
  };
  return [...degrees].sort((left, right) => distance(left) - distance(right) || left - right)[0];
}

export function chordToneWeight(chordDegrees, degree) {
  if (!Array.isArray(chordDegrees)) throw new TypeError("chordDegrees must be an array");
  return chordDegrees.includes(degree)
    ? { length: 1, gain: 1.12 }
    : { length: 0.8, gain: 0.8 };
}

export function bassGainForStep(worldId, section, sixteenthInBar) {
  getWorld(worldId);
  if (section === "intro" || section === "outro") return sixteenthInBar === 0 ? 0.9 : null;
  if (section === "outro-last") {
    if (sixteenthInBar >= 12) return null;
    return sixteenthInBar === 0 ? 0.9 : null;
  }
  const steps = worldId === "daylight" ? [0, 6, 8, 14] : [0, 6, 12];
  if (!steps.includes(sixteenthInBar)) return null;
  return sixteenthInBar === 0 || sixteenthInBar === 8 ? 0.9 : 0.7;
}

export function hatForStep(tension, sixteenthInBar) {
  if (tension < 0.3) return sixteenthInBar % 2 === 0 ? "closed" : null;
  if (tension < 0.6) return sixteenthInBar % 4 === 1 ? null : "closed";
  return sixteenthInBar === 4 || sixteenthInBar === 12 ? "open" : "closed";
}

export function kickForStep(section, sixteenthInBar) {
  if (section === "end" || (section === "outro-last" && sixteenthInBar >= 12)) return false;
  return sixteenthInBar === 0 || sixteenthInBar === 8;
}

export function snareForStep(section, sixteenthInBar) {
  return (section === "a" || section === "b") && (sixteenthInBar === 4 || sixteenthInBar === 12);
}

export function hatSwingSeconds(worldId, sixteenthInBar, beatSeconds) {
  getWorld(worldId);
  return worldId === "daylight" && sixteenthInBar % 2 === 1 ? beatSeconds * 0.25 * 0.08 : 0;
}

export function cutoffForTension(tension, minimum = 1200) {
  if (tension < 0.3) return minimum;
  if (tension >= 0.6) return 4200;
  return minimum + ((tension - 0.3) / 0.3) * (4200 - minimum);
}

export function padDetuneForTension(tension) {
  if (tension < 0.3) return 0;
  if (tension >= 0.6) return 12;
  return ((tension - 0.3) / 0.3) * 12;
}

export function quantize(nowSec, startSec, bpm, division = 4, graceSec = 0.03) {
  const gridSec = (60 / bpm) / division;
  const elapsed = Math.max(0, nowSec - startSec);
  const previousGrid = startSec + Math.floor(elapsed / gridSec) * gridSec;
  if (nowSec - previousGrid <= graceSec) return nowSec;
  return previousGrid + gridSec;
}

function interpolateInterval(dtSec, lowValue, highValue) {
  if (dtSec <= 0.08) return lowValue;
  if (dtSec >= 0.5) return highValue;
  return lowValue + ((dtSec - 0.08) / 0.42) * (highValue - lowValue);
}

export function velocityFromInterval(dtSec) {
  return interpolateInterval(dtSec, 0.5, 1);
}

export function noteLengthFromInterval(dtSec) {
  return interpolateInterval(dtSec, 0.12, 0.5);
}

export function reverbSendFromSilence(silenceBeats) {
  return 0.2 + 0.6 * clamp((silenceBeats - 1) / 3);
}
