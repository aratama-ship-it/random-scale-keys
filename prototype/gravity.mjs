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

function frozenRoles(roles) {
  return Object.freeze(Object.fromEntries(
    ROLE_ORDER.map((role) => [role, Object.freeze([...roles[role]])]),
  ));
}

export function deriveRoles(intervals) {
  if (!Array.isArray(intervals) || intervals.length < 5) {
    throw new TypeError("intervals must contain at least five scale degrees");
  }
  const tonicTriad = new Set([intervals[0], intervals[2], intervals[4]]);
  const stable = [1, 3, 5];
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
  const scale = getScale(scaleId);
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
  const scale = getScale(scaleId);
  const degree = Array.from({ length: scale.intervals.length }, (_, index) => index + 1)
    .find((candidate) => chordLabel(scaleId, candidate) === label);
  if (!degree) throw new RangeError(`Unknown chord ${label} for ${scaleId}`);
  return degree;
}

export function chordDegreeNotes(scaleId, chordName) {
  return triadForDegree(scaleId, degreeForChordLabel(scaleId, chordName)).degrees;
}

export function chordMidiNotes(worldId, scaleId, chordName, octave = 0) {
  const degrees = chordDegreeNotes(scaleId, chordName);
  let previous = -Infinity;
  return degrees.map((degree) => {
    let midi = midiForDegree(worldId, scaleId, degree, octave);
    while (midi <= previous) midi += 12;
    previous = midi;
    return midi;
  });
}

export function chordRootMidi(worldId, scaleId, chordName, octaveNumber = 2) {
  const [rootDegree] = chordDegreeNotes(scaleId, chordName);
  const pitchClass = midiForDegree(worldId, scaleId, rootDegree) % 12;
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
  const scale = getScale(scaleId);
  const count = scale.intervals.length;
  return {
    tonic: 1,
    subdominant: count >= 7 ? 4 : 3,
    dominant: count >= 7 ? (scale.intervals[count - 1] === 11 ? 5 : count) : 4,
    submediant: count >= 7 ? 6 : 2,
  };
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
  const scale = getScale(scaleId);
  const degrees = chordDegrees(scaleId);
  const tonicIntervals = triadForDegree(scaleId, degrees.tonic).intervals;
  const tonicQuality = [
    tonicIntervals[1] - tonicIntervals[0],
    tonicIntervals[2] - tonicIntervals[0],
  ];
  const isMinor = tonicQuality[0] === 3 && tonicQuality[1] === 7;
  const middleDegree = isMinor ? degrees.subdominant : degrees.submediant;
  const baseThirdDegree = isMinor ? degrees.submediant : degrees.subdominant;
  const position = barIndex % 4;
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
