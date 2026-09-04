import {
  hatForStep,
  hatSwingSeconds,
  kickForStep,
  snareForStep,
} from "./gravity.mjs";

const STEPS_PER_BAR = 16;
const PATTERN_SECTIONS = Object.freeze(["intro", "a", "b", "outro"]);
const HIT_TYPES = Object.freeze(["kick", "snare", "hatClosed", "hatOpen"]);

function velocityRow(entries = []) {
  const row = Array(STEPS_PER_BAR).fill(0);
  entries.forEach(([step, velocity]) => { row[step] = velocity; });
  return Object.freeze(row);
}

function sectionPattern({ kick = [], snare = [], hatClosed = [], hatOpen = [] }) {
  return Object.freeze({
    kick: velocityRow(kick),
    snare: velocityRow(snare),
    hatClosed: velocityRow(hatClosed),
    hatOpen: velocityRow(hatOpen),
  });
}

function repeatedPattern({ kick, snare, hatClosed, hatOpen, bHatClosed = hatClosed }) {
  const sparse = sectionPattern({ kick });
  return Object.freeze({
    intro: sparse,
    a: sectionPattern({ kick, snare, hatClosed, hatOpen }),
    b: sectionPattern({ kick, snare, hatClosed: bHatClosed, hatOpen }),
    outro: sparse,
  });
}

const everyEighth = (velocity) => Array.from({ length: 8 }, (_, index) => [index * 2, velocity]);
const everySixteenth = (velocity) => Array.from({ length: 16 }, (_, index) => [index, velocity]);

export const RHYTHMS = Object.freeze({
  gravity: Object.freeze({ label: "重力（現行）", bpm: null, source: "rules" }),
  disco: Object.freeze({
    label: "ディスコ",
    bpm: 118,
    source: "pattern",
    swing: 0,
    pattern: repeatedPattern({
      kick: [[0, 1], [4, 1], [8, 1], [12, 1]],
      snare: [[4, 0.9], [12, 0.9]],
      hatOpen: [[2, 0.7], [6, 0.7], [10, 0.7], [14, 0.7]],
      hatClosed: [[0, 0.5], [4, 0.5], [8, 0.5], [12, 0.5]],
      bHatClosed: everyEighth(0.5),
    }),
  }),
  dnb: Object.freeze({
    label: "ドラムンベース",
    bpm: 172,
    source: "pattern",
    swing: 0,
    pattern: repeatedPattern({
      kick: [[0, 1], [10, 1]],
      snare: [[4, 1], [7, 0.35], [12, 1], [15, 0.35]],
      hatClosed: everyEighth(0.5),
      bHatClosed: everySixteenth(0.4),
    }),
  }),
  pops: Object.freeze({
    label: "ポップス",
    bpm: 100,
    source: "pattern",
    swing: 0,
    pattern: repeatedPattern({
      kick: [[0, 0.9], [6, 0.9], [8, 0.9]],
      snare: [[4, 0.9], [12, 0.9]],
      hatClosed: everyEighth(0.55),
    }),
  }),
  hiphop: Object.freeze({
    label: "ヒップホップ",
    bpm: 90,
    source: "pattern",
    swing: 0.12,
    pattern: repeatedPattern({
      kick: [[0, 1], [7, 1], [10, 1]],
      snare: [[4, 0.95], [12, 0.95]],
      hatClosed: everyEighth(0.5),
    }),
  }),
});

function getRhythm(rhythmId) {
  const rhythm = RHYTHMS[rhythmId];
  if (!rhythm) throw new RangeError(`Unknown rhythm: ${rhythmId}`);
  return rhythm;
}

export function bpmForRhythm(rhythmId, worldBpm) {
  const bpm = getRhythm(rhythmId).bpm ?? worldBpm;
  if (!(Number.isFinite(bpm) && bpm > 0)) throw new TypeError("worldBpm must be a positive number");
  return bpm;
}

export function drumSwingSeconds(rhythmId, worldId, stepInBar, beatSec) {
  const rhythm = getRhythm(rhythmId);
  if (!Number.isInteger(stepInBar) || stepInBar < 0 || stepInBar >= STEPS_PER_BAR) {
    throw new RangeError(`Invalid step in bar: ${stepInBar}`);
  }
  if (!(Number.isFinite(beatSec) && beatSec > 0)) throw new TypeError("beatSec must be a positive number");
  if (rhythm.source === "rules") return hatSwingSeconds(worldId, stepInBar, beatSec);
  return stepInBar % 2 === 1 ? beatSec / 4 * (rhythm.swing ?? 0) : 0;
}

export function drumHitsForStep(rhythmId, section, stepInBar, tension = 0) {
  const rhythm = getRhythm(rhythmId);
  if (!Number.isInteger(stepInBar) || stepInBar < 0 || stepInBar >= STEPS_PER_BAR) {
    throw new RangeError(`Invalid step in bar: ${stepInBar}`);
  }

  if (rhythm.source === "rules") {
    const hits = [];
    if (kickForStep(section, stepInBar)) hits.push({ type: "kick", velocity: 1 });
    if (snareForStep(section, stepInBar)) hits.push({ type: "snare", velocity: 1 });
    if (section === "a" || section === "b") {
      const hat = hatForStep(tension, stepInBar);
      if (hat) hits.push({ type: hat === "open" ? "hatOpen" : "hatClosed", velocity: 1 });
    }
    return hits;
  }

  if (rhythm.source !== "pattern") throw new RangeError(`Unsupported rhythm source: ${rhythm.source}`);
  if (section === "end") return [];
  const patternSection = section === "outro-last" ? "outro" : section;
  if (!PATTERN_SECTIONS.includes(patternSection)) throw new RangeError(`Unknown rhythm section: ${section}`);
  const pattern = rhythm.pattern[patternSection];
  const hits = HIT_TYPES.flatMap((type) => {
    const velocity = pattern[type][stepInBar];
    return velocity > 0 ? [{ type, velocity }] : [];
  });
  if (tension >= 0.6 && (stepInBar === 4 || stepInBar === 12)) {
    hits.push({ type: "hatOpen", velocity: 1 });
  }
  return hits;
}
