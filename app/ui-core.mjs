const VALID_WORLDS = new Set(["daylight", "night"]);

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
  finished: Object.freeze({ RETAKE: "countin", REROLL: "idle" }),
});

export function transition(state, event) {
  const eventType = typeof event === "string" ? event : event?.type;
  return TRANSITIONS[state]?.[eventType] ?? state;
}

export function parseParams(search = "") {
  const params = new URLSearchParams(search);
  const requestedWorld = params.get("world");
  return {
    world: VALID_WORLDS.has(requestedWorld) ? requestedWorld : "daylight",
    seed: params.get("seed") ?? "",
  };
}

export function formatParams({ world, seed }) {
  const params = new URLSearchParams();
  params.set("world", VALID_WORLDS.has(world) ? world : "daylight");
  params.set("seed", String(seed ?? ""));
  return `?${params.toString()}`;
}

export function rowOffsetPx(rowIndex, keySize) {
  const ratios = [0, 0.25, 0.625];
  return Math.round((ratios[rowIndex] ?? 0) * keySize);
}
