export const KEY_CODES = Object.freeze(
  Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
);

export const ROLE_COUNTS = Object.freeze({ stable: 12, floating: 7, tension: 7 });
export const EFFECT_COUNTS = Object.freeze({ none: 14, delay: 4, sweep: 3, octave: 3, stutter: 2 });

export const WORLDS = Object.freeze({
  daylight: Object.freeze({
    id: "daylight",
    label: "A: daylight",
    bpm: 100,
    rootMidi: 60,
    scale: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
    roles: Object.freeze({
      stable: Object.freeze([1, 3, 5]),
      floating: Object.freeze([2, 6]),
      tension: Object.freeze([4, 7]),
    }),
    chords: Object.freeze({
      I: Object.freeze([1, 3, 5]),
      vi: Object.freeze([6, 1, 3]),
      IV: Object.freeze([4, 6, 1]),
      V: Object.freeze([5, 7, 2]),
    }),
  }),
  night: Object.freeze({
    id: "night",
    label: "B: night",
    bpm: 88,
    rootMidi: 57,
    scale: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
    roles: Object.freeze({
      stable: Object.freeze([1, 3, 5]),
      floating: Object.freeze([2, 4]),
      tension: Object.freeze([6, 7]),
    }),
    chords: Object.freeze({
      i: Object.freeze([1, 3, 5]),
      VI: Object.freeze([6, 1, 3]),
      iv: Object.freeze([4, 6, 1]),
      VII: Object.freeze([7, 2, 4]),
    }),
  }),
});

const ROLE_DELTA = Object.freeze({ stable: -0.3, floating: 0.05, tension: 0.22 });

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

export function roleForDegree(worldId, degree) {
  const world = getWorld(worldId);
  const entry = Object.entries(world.roles).find(([, degrees]) => degrees.includes(degree));
  if (!entry) throw new RangeError(`Invalid scale degree: ${degree}`);
  return entry[0];
}

export function midiForDegree(worldId, degree, octave = 0) {
  const world = getWorld(worldId);
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError(`Invalid scale degree: ${degree}`);
  }
  return world.rootMidi + world.scale[degree - 1] + octave * 12;
}

export function chordMidiNotes(worldId, chordName, octave = 0) {
  const world = getWorld(worldId);
  const degrees = world.chords[chordName];
  if (!degrees) throw new RangeError(`Unknown chord ${chordName} for ${worldId}`);
  let previous = -Infinity;
  return degrees.map((degree) => {
    let midi = midiForDegree(worldId, degree, octave);
    while (midi <= previous) midi += 12;
    previous = midi;
    return midi;
  });
}

export function chordRootMidi(worldId, chordName, octaveNumber = 2) {
  const world = getWorld(worldId);
  const degrees = world.chords[chordName];
  if (!degrees) throw new RangeError(`Unknown chord ${chordName} for ${worldId}`);
  const pitchClass = midiForDegree(worldId, degrees[0]) % 12;
  return (octaveNumber + 1) * 12 + pitchClass;
}

export function createLayout(seed, worldId) {
  const normalizedSeed = hashSeed(seed);
  const random = mulberry32(normalizedSeed);
  const world = getWorld(worldId);
  const roles = shuffled(expandedCounts(ROLE_COUNTS), random);
  const effects = shuffled(expandedCounts(EFFECT_COUNTS), random);
  const degreesByRole = Object.fromEntries(
    Object.entries(ROLE_COUNTS).map(([role, count]) => [
      role,
      balancedDegrees(world.roles[role], count, random),
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
      midi: midiForDegree(worldId, degree, octave),
      role,
      effect: effects[index],
    };
  });

  return { seed: normalizedSeed, worldId, keys };
}

export function decayTension(tension, deltaBeats) {
  return clamp(tension * Math.exp(-Math.max(0, deltaBeats) / 8));
}

export function updateTension(tension, deltaBeats, role) {
  if (!(role in ROLE_DELTA)) throw new RangeError(`Unknown role: ${role}`);
  return clamp(decayTension(tension, deltaBeats) + ROLE_DELTA[role]);
}

export function isResolution(previousTension, nextTension, role) {
  return role === "stable" && previousTension >= 0.5 && nextTension < 0.25;
}

export function tonicChordForWorld(worldId) {
  getWorld(worldId);
  return worldId === "daylight" ? "I" : "i";
}

export function chordForTension(worldId, tension, barIndex = 0) {
  getWorld(worldId);
  if (tension < 0.3) return tonicChordForWorld(worldId);
  if (tension < 0.6) {
    if (worldId === "daylight") return barIndex % 2 === 0 ? "vi" : "IV";
    return barIndex % 2 === 0 ? "VI" : "iv";
  }
  return worldId === "daylight" ? "V" : "VII";
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

export function chordForBar(worldId, barIndex, tension) {
  getWorld(worldId);
  if (!Number.isInteger(barIndex) || barIndex < 0) {
    throw new RangeError(`Invalid bar index: ${barIndex}`);
  }
  const position = barIndex % 4;
  const loop = worldId === "daylight" ? ["I", "I", "IV", "V"] : ["i", "i", "VI", "VII"];
  if (tension >= 0.6 && position !== 3) return worldId === "daylight" ? "V" : "VII";
  if (tension >= 0.3 && tension < 0.6 && position === 1) {
    return worldId === "daylight" ? "vi" : "iv";
  }
  return loop[position];
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

export function answerDegree(worldId, lastDegree, chordName) {
  const chordDegrees = getWorld(worldId).chords[chordName];
  if (!chordDegrees) throw new RangeError(`Unknown chord ${chordName} for ${worldId}`);
  if (!Number.isInteger(lastDegree) || lastDegree < 1 || lastDegree > 7) {
    throw new RangeError(`Invalid scale degree: ${lastDegree}`);
  }
  const distance = (degree) => {
    const direct = Math.abs(degree - lastDegree);
    return Math.min(direct, 7 - direct);
  };
  return [...chordDegrees].sort((left, right) => distance(left) - distance(right) || left - right)[0];
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
