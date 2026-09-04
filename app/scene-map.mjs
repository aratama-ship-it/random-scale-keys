import {
  accentForBeat,
  answerDegree,
  chordDegreeNotes,
  chordMidiNotes,
  chordToneWeight,
  chooseChord,
  decayTension,
  getWorld,
  getScale,
  hashSeed,
  isResolution,
  midiForDegree,
  noteMemory,
  mulberry32,
  noteLengthFromInterval,
  quantize as quantizeTime,
  resolveScaleId,
  roleForDegree,
  sectionForBar,
  tonicChordForScale,
  updateTension,
  velocityFromInterval,
  voiceLead,
} from "../prototype/gravity.mjs";

const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4;
const EPSILON = 1e-9;

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function eventSignature(event) {
  return [event.type, event.propId, event.performerId, event.handJoint].join("\u0000");
}

function canonicalEvents(scene) {
  const duration = scene.timeline.durationSeconds;
  const startSignatures = new Set(
    scene.events
      .filter((event) => Math.abs(event.t) <= EPSILON)
      .map(eventSignature),
  );
  return scene.events.filter((event) => !(
    Math.abs(event.t - duration) <= EPSILON
    && startSignatures.has(eventSignature(event))
  ));
}

function validateScene(scene) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw new TypeError("Motion Scene がオブジェクトではありません");
  if (scene.format !== "juggling-motion-scene") throw new TypeError("format が juggling-motion-scene ではありません");
  if (!(scene.timeline?.durationSeconds > 0)) throw new TypeError("timeline.durationSeconds が正の数値ではありません");
  if (scene.timeline.loopMode !== "entity_exact") throw new TypeError("timeline.loopMode が entity_exact ではありません");
  if (!Array.isArray(scene.events)) throw new TypeError("events 配列がありません");
  if (!Array.isArray(scene.props)) throw new TypeError("props 配列がありません");
}

export function detectFormat(value) {
  if (value?.version === "gravity-v0") return "gravity-v0";
  if (value?.format === "juggling-motion-scene") return "juggling-motion-scene";
  return "unknown";
}

export function assignDegrees(propIds, seed, scaleId) {
  const scale = getScale(scaleId);
  if (!Array.isArray(propIds)) throw new TypeError("propIds must be an array");
  const ids = [...new Set(propIds.map(String))];
  const random = mulberry32(hashSeed(seed));
  const result = {};
  let degreePool = [];
  ids.forEach((propId) => {
    if (degreePool.length === 0) {
      degreePool = shuffled(Array.from({ length: scale.intervals.length }, (_, index) => index + 1), random);
    }
    result[propId] = degreePool.shift();
  });
  return result;
}

export function flightTimes(scene) {
  validateScene(scene);
  const duration = scene.timeline.durationSeconds;
  const events = canonicalEvents(scene);
  const releasesByProp = new Map();
  events.forEach((event) => {
    if (event.type !== "release" || !Number.isFinite(event.t)) return;
    const releases = releasesByProp.get(event.propId) ?? [];
    releases.push(event);
    releasesByProp.set(event.propId, releases);
  });
  releasesByProp.forEach((releases) => releases.sort((left, right) => left.t - right.t));

  return events
    .filter((event) => event.type === "catch" && Number.isFinite(event.t))
    .map((catchEvent) => {
      const releases = releasesByProp.get(catchEvent.propId) ?? [];
      const earlier = releases.filter((event) => event.t <= catchEvent.t + EPSILON).at(-1);
      const wrapped = earlier ? undefined : releases.at(-1);
      const releaseEvent = earlier ?? wrapped;
      if (!releaseEvent) return null;
      const flightSec = earlier
        ? catchEvent.t - releaseEvent.t
        : catchEvent.t + duration - releaseEvent.t;
      if (!(flightSec > EPSILON)) return null;
      return {
        propId: catchEvent.propId,
        releaseId: releaseEvent.id,
        catchId: catchEvent.id,
        releaseTime: releaseEvent.t,
        catchTime: catchEvent.t,
        flightSec,
        wrapped: !earlier,
      };
    })
    .filter(Boolean);
}

function normalizedQuantize(value) {
  const enabled = value?.enabled === true;
  const division = enabled && Number.isInteger(value.division) && value.division > 0
    ? value.division
    : null;
  return { enabled: division !== null, division };
}

function sceneProps(scene) {
  const ids = [
    ...scene.props.map((prop) => prop?.id),
    ...scene.events.map((event) => event?.propId),
  ].filter((value) => typeof value === "string" && value.length > 0);
  return [...new Set(ids)];
}

export function sceneToEvents(scene, { worldId, scaleId: requestedScaleId, seed, bpm, bars, quantize } = {}) {
  validateScene(scene);
  const world = getWorld(worldId);
  const scaleId = resolveScaleId(worldId, requestedScaleId);
  if (!(Number.isFinite(bpm) && bpm > 0)) throw new TypeError("bpm が正の数値ではありません");
  if (!(Number.isInteger(bars) && bars > 0)) throw new TypeError("bars が正の整数ではありません");

  const normalizedSeed = hashSeed(seed);
  const quantizeSetting = normalizedQuantize(quantize);
  const assignments = assignDegrees(sceneProps(scene), normalizedSeed, scaleId);
  const flights = new Map(flightTimes(scene).map((entry) => [entry.catchId, entry.flightSec]));
  const duration = scene.timeline.durationSeconds;
  const beatSec = 60 / bpm;
  const takeDuration = bars * BEATS_PER_BAR * beatSec;
  const sourceEvents = canonicalEvents(scene)
    .filter((event) => Number.isFinite(event.t) && (event.type === "release" || event.type === "catch"));
  const motionEvents = [];

  for (let loop = 0; loop * duration < takeDuration - EPSILON; loop += 1) {
    sourceEvents.forEach((source, sourceIndex) => {
      const rawTime = source.t + loop * duration;
      if (rawTime >= takeDuration - EPSILON) return;
      const scheduledTime = quantizeSetting.enabled
        ? quantizeTime(rawTime, 0, bpm, quantizeSetting.division, 0.03)
        : rawTime;
      if (scheduledTime >= takeDuration - EPSILON) return;
      motionEvents.push({ source, sourceIndex, loop, rawTime, time: scheduledTime, beat: scheduledTime / beatSec });
    });
  }
  motionEvents.sort((left, right) => (
    left.beat - right.beat
    || left.rawTime - right.rawTime
    || left.sourceIndex - right.sourceIndex
  ));

  const events = [];
  let order = 0;
  let tension = 0;
  let lastTensionBeat = 0;
  let lastPressBeat = 0;
  let lastRawCatchTime = -Infinity;
  let lastPressEvent;
  let currentChord = tonicChordForScale(scaleId);
  let nextChord = currentChord;
  let padVoices;
  const chordHistory = [];
  let pendingResolutionBeat = Infinity;
  let answerCount = 0;
  let motionIndex = 0;

  const addEvent = (event) => events.push({ ...event, _order: order++ });

  const processMotion = (item) => {
    const { source, beat, time, rawTime, loop } = item;
    const degree = assignments[source.propId];
    if (!degree) throw new TypeError(`propId ${source.propId} に度数を割り当てられません`);
    const octave = source.handJoint === "wrist.L" ? -1 : 0;
    const role = roleForDegree(scaleId, degree);
    const common = {
      time,
      beat,
      code: null,
      midi: midiForDegree(worldId, scaleId, degree, octave),
      degree,
      role,
      effect: "none",
      sourceId: "motion-scene",
      section: sectionForBar(Math.min(bars - 1, Math.floor(beat / BEATS_PER_BAR))),
      propId: source.propId,
      handJoint: source.handJoint,
      sceneTime: source.t,
      sceneLoop: loop,
      confidence: source.confidence,
    };

    if (source.type === "release") {
      addEvent({
        ...common,
        kind: "release",
        velocity: 0,
        length: 0,
        tBefore: tension,
        tAfter: tension,
        resolution: false,
      });
      return;
    }

    const flightSec = flights.get(source.id);
    if (!(flightSec > 0)) throw new TypeError(`catch ${source.id} に対応する release がありません`);
    const interval = rawTime - lastRawCatchTime;
    const deltaBeats = Math.max(0, beat - lastTensionBeat);
    const previousTension = decayTension(tension, deltaBeats);
    const nextTension = updateTension(tension, deltaBeats, role, scaleId);
    const resolution = isResolution(previousTension, nextTension, role);
    const accent = accentForBeat(beat % BEATS_PER_BAR);
    const chordWeight = chordToneWeight(chordDegreeNotes(scaleId, currentChord), degree);
    const silenceBeforePress = beat - lastPressBeat;
    const returnGain = silenceBeforePress >= 4 ? 1.2 : 1;
    const returnLength = silenceBeforePress >= 4 ? 1.5 : 1;
    const loggedEvent = {
      ...common,
      kind: "press",
      velocity: velocityFromInterval(interval) * accent.gain * chordWeight.gain * returnGain,
      length: noteLengthFromInterval(flightSec) * accent.length * chordWeight.length * returnLength,
      tBefore: previousTension,
      tAfter: nextTension,
      resolution,
      flightSec,
    };
    addEvent(loggedEvent);
    tension = nextTension;
    lastTensionBeat = beat;
    lastPressBeat = beat;
    lastRawCatchTime = rawTime;
    lastPressEvent = loggedEvent;
    if (resolution) pendingResolutionBeat = Math.floor(beat) + 1;
  };

  const scheduleStep = (step) => {
    const beat = step / STEPS_PER_BEAT;
    const barIndex = Math.floor(step / (STEPS_PER_BEAT * BEATS_PER_BAR));
    const stepInBar = step % (STEPS_PER_BEAT * BEATS_PER_BAR);
    const section = sectionForBar(barIndex);
    let resolving = false;

    if (section === "end") {
      tension = decayTension(tension, beat - lastTensionBeat);
      lastTensionBeat = beat;
      currentChord = tonicChordForScale(scaleId);
    } else {
      resolving = beat >= pendingResolutionBeat;
      if (stepInBar === 0) {
        tension = decayTension(tension, beat - lastTensionBeat);
        lastTensionBeat = beat;
        currentChord = resolving || barIndex === 0 ? tonicChordForScale(scaleId) : nextChord;
        const pitchClasses = chordMidiNotes(worldId, scaleId, currentChord).map((midi) => midi % 12);
        padVoices = voiceLead(padVoices, pitchClasses);
        chordHistory.push(currentChord);
      }
    }

    const schedulesAnswer = beat !== 0
      && beat % 8 === 0
      && answerCount < 8
      && lastPressEvent
      && lastPressEvent.beat >= beat - 1
      && lastPressEvent.beat < beat
      && lastPressEvent.role !== "stable";
    if (schedulesAnswer) {
      const degree = answerDegree(scaleId, lastPressEvent.degree, currentChord);
      addEvent({
        time: beat * beatSec,
        beat,
        kind: "answer",
        code: null,
        midi: midiForDegree(worldId, scaleId, degree, 0),
        degree,
        role: roleForDegree(scaleId, degree),
        effect: "none",
        velocity: 0.45,
        length: 0.6,
        tBefore: tension,
        tAfter: tension,
        resolution: false,
        sourceId: "motion-scene",
        section,
      });
      answerCount += 1;
    }
    if (section !== "end" && resolving) {
      currentChord = tonicChordForScale(scaleId);
      pendingResolutionBeat = Infinity;
    }
  };

  const commitNextChord = (step) => {
    const beat = step / STEPS_PER_BEAT;
    const barIndex = Math.floor(step / (STEPS_PER_BEAT * BEATS_PER_BAR));
    if (step % (STEPS_PER_BEAT * BEATS_PER_BAR) !== 14 || barIndex + 1 >= bars) return;
    let repeatCount = 0;
    for (let index = chordHistory.length - 1; index >= 0 && chordHistory[index] === currentChord; index -= 1) repeatCount += 1;
    const resolution = events.some((event) => (
      event.kind === "press"
      && event.resolution === true
      && event.beat >= barIndex * BEATS_PER_BAR
      && event.beat <= beat
    ));
    nextChord = chooseChord({
      scaleId,
      section: sectionForBar(barIndex + 1),
      sectionBar: (barIndex + 1) % BEATS_PER_BAR,
      tension: decayTension(tension, beat - lastTensionBeat),
      memory: noteMemory(events, beat),
      previousChord: currentChord,
      repeatCount,
      previousVoices: padVoices,
      tonicPitchClass: world.rootMidi % 12,
      resolution,
    });
  };

  const finalStep = bars * BEATS_PER_BAR * STEPS_PER_BEAT;
  for (let step = 0; step <= finalStep; step += 1) {
    const stepBeat = step / STEPS_PER_BEAT;
    while (motionIndex < motionEvents.length && motionEvents[motionIndex].beat < stepBeat - EPSILON) {
      processMotion(motionEvents[motionIndex++]);
    }
    scheduleStep(step);
    while (motionIndex < motionEvents.length && motionEvents[motionIndex].beat <= stepBeat + EPSILON) {
      processMotion(motionEvents[motionIndex++]);
    }
    commitNextChord(step);
  }
  while (motionIndex < motionEvents.length) processMotion(motionEvents[motionIndex++]);

  const sortedEvents = events
    .sort((left, right) => left.time - right.time || left._order - right._order)
    .map(({ _order, ...event }) => event);
  return {
    version: "gravity-v0",
    engine: "accomp-v2",
    worldId,
    scaleId,
    seed: normalizedSeed,
    bpm,
    bars,
    quantize: quantizeSetting,
    events: sortedEvents,
    motionScene: {
      sceneId: scene.sceneId,
      title: scene.metadata?.title,
      pattern: scene.metadata?.pattern,
      propCount: scene.metadata?.propCount ?? sceneProps(scene).length,
      durationSeconds: duration,
    },
  };
}
