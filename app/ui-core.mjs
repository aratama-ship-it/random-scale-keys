import { SCALES, resolveScaleId } from "../prototype/gravity.mjs";

const VALID_WORLDS = new Set(["daylight", "night"]);

function validKeyChoice(value) {
  if (value === "random") return "random";
  const number = typeof value === "number"
    ? value
    : (typeof value === "string" && /^(?:[0-9]|1[01])$/.test(value) ? Number(value) : NaN);
  return Number.isInteger(number) && number >= 0 && number <= 11 ? number : undefined;
}

export function lerpColor(fromHex, toHex, amount) {
  const t = Math.min(1, Math.max(0, Number(amount)));
  const parse = (hex) => {
    const value = hex.replace(/^#/, "");
    if (!/^[\da-f]{6}$/i.test(value)) throw new TypeError(`Invalid HEX color: ${hex}`);
    return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  };
  const channel = (start, end) => Math.round(start + (end - start) * t)
    .toString(16)
    .padStart(2, "0");
  const from = parse(fromHex);
  const to = parse(toHex);
  return `#${from.map((value, index) => channel(value, to[index])).join("")}`.toUpperCase();
}

const TRANSITIONS = Object.freeze({
  idle: Object.freeze({ START: "countin" }),
  countin: Object.freeze({ COUNTIN_COMPLETE: "playing", STOP: "finished" }),
  playing: Object.freeze({ TAKE_COMPLETE: "finished", STOP: "finished" }),
  finished: Object.freeze({ RETAKE: "countin", REROLL: "idle", REPLAY: "replay" }),
  replay: Object.freeze({ REPLAY_END: "finished", STOP: "finished" }),
});

export function transition(state, event) {
  const eventType = typeof event === "string" ? event : event?.type;
  return TRANSITIONS[state]?.[eventType] ?? state;
}

export function diagnosticDisabledForState(state) {
  return state !== "idle" && state !== "finished";
}

export function nextTakeSettingsDisabledForState(state) {
  return state === "countin" || state === "playing" || state === "replay";
}

export function parseParams(search = "") {
  const params = new URLSearchParams(search);
  const requestedWorld = params.get("world");
  const world = VALID_WORLDS.has(requestedWorld) ? requestedWorld : "daylight";
  return {
    world,
    scale: resolveScaleId(world, params.get("scale")),
    seed: params.get("seed") ?? "",
    key: validKeyChoice(params.get("key")),
  };
}

export function formatParams({ world, scale, seed, key }) {
  const params = new URLSearchParams();
  const validWorld = VALID_WORLDS.has(world) ? world : "daylight";
  params.set("world", validWorld);
  params.set("scale", resolveScaleId(validWorld, scale));
  params.set("seed", String(seed ?? ""));
  const normalizedKey = validKeyChoice(key);
  if (normalizedKey !== undefined) params.set("key", String(normalizedKey));
  return `?${params.toString()}`;
}

export function remainingSeconds(now, takeStart, takeEnd) {
  if (![now, takeStart, takeEnd].every(Number.isFinite)) {
    throw new TypeError("now, takeStart, and takeEnd must be finite numbers");
  }
  return Math.ceil(Math.max(0, takeEnd - Math.max(now, takeStart)));
}

export function holdRelease(pressWhen, naturalLength, nowSec, maxHoldSec) {
  if (![pressWhen, naturalLength, nowSec, maxHoldSec].every(Number.isFinite)) {
    throw new TypeError("hold release values must be finite numbers");
  }
  const releaseAt = Math.min(
    Math.max(nowSec, pressWhen + naturalLength),
    pressWhen + maxHoldSec,
  );
  const length = releaseAt - pressWhen;
  return {
    releaseAt,
    length,
    held: length > naturalLength + 1e-6,
  };
}

export function rowOffsetPx(rowIndex, keySize) {
  const ratios = [0, 0.25, 0.625];
  return Math.round((ratios[rowIndex] ?? 0) * keySize);
}

export function roleElevation(role) {
  return { tension: 1, floating: 0.3, stable: -0.6 }[role] ?? 0;
}

export function fieldAt(x, y, sources, sigma) {
  if (!(sigma > 0)) throw new RangeError("sigma must be greater than zero");
  const denominator = 2 * sigma * sigma;
  return sources.reduce((total, source) => {
    const dx = x - source.x;
    const dy = y - source.y;
    const elevation = source.elevation ?? roleElevation(source.role);
    return total + elevation * Math.exp(-((dx * dx) + (dy * dy)) / denominator);
  }, 0);
}

function interpolatePoint(first, second, level) {
  const difference = second.value - first.value;
  const amount = difference === 0 ? 0.5 : (level - first.value) / difference;
  return {
    x: first.x + (second.x - first.x) * amount,
    y: first.y + (second.y - first.y) * amount,
  };
}

export function marchingSquares(grid, cols, rows, level, cellSize, flatThreshold = 0) {
  if (!Array.isArray(grid) && !ArrayBuffer.isView(grid)) return [];
  if (cols < 2 || rows < 2 || grid.length < cols * rows) return [];
  const segments = [];
  const pairsByCase = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
    5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
    9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]],
    13: [[0, 1]], 14: [[0, 3]],
  };

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const x = col * cellSize;
      const y = row * cellSize;
      const corners = [
        { x, y, value: grid[row * cols + col] },
        { x: x + cellSize, y, value: grid[row * cols + col + 1] },
        { x: x + cellSize, y: y + cellSize, value: grid[(row + 1) * cols + col + 1] },
        { x, y: y + cellSize, value: grid[(row + 1) * cols + col] },
      ];
      if (!corners.some((corner) => Math.abs(corner.value) >= flatThreshold)) continue;
      const mask = corners.reduce((value, corner, index) => value | (corner.value >= level ? 1 << index : 0), 0);
      const edgePoints = [
        interpolatePoint(corners[0], corners[1], level),
        interpolatePoint(corners[1], corners[2], level),
        interpolatePoint(corners[2], corners[3], level),
        interpolatePoint(corners[3], corners[0], level),
      ];
      (pairsByCase[mask] ?? []).forEach(([firstEdge, secondEdge]) => {
        segments.push([edgePoints[firstEdge], edgePoints[secondEdge]]);
      });
    }
  }
  return segments;
}

export function validateTakeLog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "JSONのルートがオブジェクトではありません" };
  if (value.version !== "gravity-v0") return { ok: false, reason: "version が gravity-v0 ではありません" };
  if (!VALID_WORLDS.has(value.worldId)) return { ok: false, reason: "worldId が daylight または night ではありません" };
  if (value.scaleId !== undefined && !Object.hasOwn(SCALES, value.scaleId)) return { ok: false, reason: "scaleId が既知の音階ではありません" };
  if (value.rootMidi !== undefined && (!Number.isInteger(value.rootMidi) || value.rootMidi < 0 || value.rootMidi > 127)) return { ok: false, reason: "rootMidi がMIDIノート番号ではありません" };
  if (value.key !== undefined && (!Number.isInteger(value.key) || value.key < 0 || value.key > 11)) return { ok: false, reason: "key が0から11の整数ではありません" };
  if (value.rootMidi !== undefined && value.key !== undefined && value.rootMidi % 12 !== value.key) return { ok: false, reason: "rootMidi と key が一致しません" };
  if (typeof value.seed !== "number" || !Number.isFinite(value.seed)) return { ok: false, reason: "seed が数値ではありません" };
  if (typeof value.bpm !== "number" || !Number.isFinite(value.bpm) || value.bpm <= 0) return { ok: false, reason: "bpm が正の数値ではありません" };
  if (!Number.isInteger(value.bars) || value.bars <= 0) return { ok: false, reason: "bars が正の整数ではありません" };
  if (value.melody !== undefined && value.melody !== "gravity" && value.melody !== "off") return { ok: false, reason: "melody が gravity または off ではありません" };
  if (!value.quantize || typeof value.quantize !== "object" || Array.isArray(value.quantize)) return { ok: false, reason: "quantize オブジェクトがありません" };
  if (!Array.isArray(value.events)) return { ok: false, reason: "events 配列がありません" };
  const requiredFor = (event) => event?.kind === "sfx"
    ? ["time", "beat", "kind", "code", "sfx", "variant", "velocity"]
    : ["time", "beat", "kind", "midi", "degree", "role", "velocity", "length"];
  const invalidIndex = value.events.findIndex((event) => (
    !event || typeof event !== "object" || requiredFor(event).some((key) => !(key in event))
  ));
  if (invalidIndex !== -1) return { ok: false, reason: `events[${invalidIndex}] に必須項目がありません` };
  const invalidTypeIndex = value.events.findIndex((event) => (
    event.kind === "sfx"
      ? !["time", "beat", "variant", "velocity"].every((key) => typeof event[key] === "number" && Number.isFinite(event[key]))
        || typeof event.code !== "string"
        || typeof event.sfx !== "string"
      : !["time", "beat", "midi", "degree", "velocity", "length"].every((key) => typeof event[key] === "number" && Number.isFinite(event[key]))
        || typeof event.kind !== "string"
        || typeof event.role !== "string"
        || (event.timbre !== undefined && typeof event.timbre !== "string")
        || (event.held !== undefined && typeof event.held !== "boolean")
        || (event.keyDegree !== undefined && (!Number.isInteger(event.keyDegree) || event.keyDegree < 1))
        || (event.keyMidi !== undefined && (typeof event.keyMidi !== "number" || !Number.isFinite(event.keyMidi)))
        || (event.bent !== undefined && typeof event.bent !== "boolean")
        || (event.rule !== undefined && !["fold", "tritone", "leading", "recover"].includes(event.rule))
  ));
  if (invalidTypeIndex !== -1) return { ok: false, reason: `events[${invalidTypeIndex}] の項目型が正しくありません` };
  return { ok: true };
}

export function pressTracker() {
  const active = new Set();
  let maximum = 0;
  let maximumKeys = [];
  return {
    add(code) {
      active.add(code);
      if (active.size > maximum) {
        maximum = active.size;
        maximumKeys = [...active];
      }
      return active.size;
    },
    remove(code) {
      active.delete(code);
      return active.size;
    },
    get current() { return active.size; },
    get max() { return maximum; },
    get maxKeys() { return [...maximumKeys]; },
  };
}
