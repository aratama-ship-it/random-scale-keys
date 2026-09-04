import {
  accentForBeat,
  answerDegree,
  bassGainForStep,
  chordDegreeNotes,
  chordForBar,
  chordRootMidi,
  chordToneWeight,
  createLayout,
  decayTension,
  getWorld,
  hatForStep,
  hatSwingSeconds,
  isResolution,
  kickForStep,
  midiForDegree,
  noteLengthFromInterval,
  quantize,
  reverbSendFromSilence,
  roleForDegree,
  sectionForBar,
  snareForStep,
  tonicChordForScale,
  updateTension,
  velocityFromInterval,
} from "./gravity.mjs";
import { downloadTakeJson, downloadTakeWav, scheduleRecordedTake } from "./render.js";
import { createSynth } from "./synth.js";

const BARS = 16;
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_INTERVAL_MS = 25;

const elements = {
  world: document.querySelector("#world"),
  seed: document.querySelector("#seed"),
  quantize: document.querySelector("#quantize"),
  reroll: document.querySelector("#reroll"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  replay: document.querySelector("#replay"),
  wav: document.querySelector("#wav"),
  json: document.querySelector("#json"),
  layout: document.querySelector("#layout"),
  status: document.querySelector("#status"),
  quantizeStatus: document.querySelector("#quantize-status"),
  tension: document.querySelector("#tension"),
  tensionValue: document.querySelector("#tension-value"),
  position: document.querySelector("#position"),
  chord: document.querySelector("#chord"),
  eventCount: document.querySelector("#event-count"),
  section: document.querySelector("#section"),
  answer: document.querySelector("#answer"),
};

let layout;
let audioContext;
let synth;
let schedulerTimer;
let finishTimer;
let tailTimer;
let phase = "idle";
let takeStart = 0;
let takeEnd = 0;
let nextStep = 0;
let tension = 0;
let lastTensionBeat = 0;
let lastPressBeat = 0;
let lastPhysicalPressTime = -Infinity;
let currentChord = "I";
let pendingResolutionBeat = Infinity;
let resolutionReverbUntilBeat = -Infinity;
let takeLog = null;
let lastPressEvent = null;
let answerCount = 0;
let answerTimer;
let scheduledAnswerTimers = [];

function newSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

function normalizedInputSeed() {
  const raw = elements.seed.value.trim();
  if (raw === "") return newSeed();
  return /^[+-]?\d+$/.test(raw) ? Number(raw) : raw;
}

function setControls() {
  const active = phase === "count-in" || phase === "playing" || phase === "replay";
  elements.world.disabled = active;
  elements.seed.disabled = active;
  elements.quantize.disabled = active;
  elements.reroll.disabled = active;
  elements.start.disabled = active;
  elements.stop.disabled = !active;
  elements.replay.disabled = active || !takeLog;
  elements.wav.disabled = active || !takeLog;
  elements.json.disabled = active || !takeLog;
}

function selectedQuantize() {
  const division = { 4: 1, 8: 2, 16: 4 }[elements.quantize.value] ?? null;
  return { enabled: division !== null, division };
}

function updateQuantizeDisplay() {
  const labels = { off: "OFF", 4: "4分", 8: "8分", 16: "16分" };
  elements.quantizeStatus.textContent = labels[elements.quantize.value];
}

function renderLayout() {
  elements.layout.replaceChildren();
  KEY_ROWS.forEach((row) => {
    const rowElement = document.createElement("div");
    rowElement.className = "key-row";
    [...row].forEach((letter) => {
      const code = `Key${letter}`;
      const assignment = layout.keys[code];
      const key = document.createElement("div");
      key.className = `key role-${assignment.role}`;
      key.dataset.code = code;
      const octave = assignment.octave > 0 ? `+${assignment.octave}` : String(assignment.octave);
      key.textContent = `${letter}  ${assignment.degree}(${octave}) ${assignment.role} ${assignment.effect}`;
      rowElement.append(key);
    });
    elements.layout.append(rowElement);
  });
}

function rebuildLayout() {
  layout = createLayout(normalizedInputSeed(), elements.world.value);
  elements.seed.value = String(layout.seed);
  currentChord = tonicChordForScale(layout.scaleId);
  elements.chord.textContent = currentChord;
  renderLayout();
}

function setKeyPressed(code, pressed) {
  elements.layout.querySelector(`[data-code="${code}"]`)?.classList.toggle("pressed", pressed);
}

function rootMidiForChord(worldId, scaleId, chordName) {
  return chordRootMidi(worldId, scaleId, chordName, 2);
}

function showAnswer(degree) {
  clearTimeout(answerTimer);
  elements.answer.textContent = `応答: 度数${degree}`;
  answerTimer = setTimeout(() => {
    elements.answer.textContent = "";
  }, 1000);
}

function scheduleAnswerDisplay(degree, delayMs) {
  const timer = setTimeout(() => showAnswer(degree), Math.max(0, delayMs));
  scheduledAnswerTimers.push(timer);
}

function scheduleAnswerAtBoundary(beat, when, section) {
  if (beat === 0 || beat % 8 !== 0 || answerCount >= 8 || !lastPressEvent) return;
  if (lastPressEvent.beat < beat - 1 || lastPressEvent.beat >= beat || lastPressEvent.role === "stable") return;
  const degree = answerDegree(layout.scaleId, lastPressEvent.degree, currentChord);
  const event = {
    time: when - takeStart,
    beat,
    kind: "answer",
    code: null,
    midi: midiForDegree(layout.worldId, layout.scaleId, degree, 0),
    degree,
    role: roleForDegree(layout.scaleId, degree),
    effect: "none",
    velocity: 0.45,
    length: 0.6,
    tBefore: tension,
    tAfter: tension,
    resolution: false,
    sourceId: "gravity",
    section,
  };
  synth.scheduleLead(event, when, event.length, event.velocity, "none", tension, {
    cutoffMinimum: section === "b" ? 1800 : 1200,
  });
  takeLog.events.push(event);
  answerCount += 1;
  scheduleAnswerDisplay(degree, (when - audioContext.currentTime) * 1000);
}

function scheduleAccompanimentStep(step) {
  const world = getWorld(layout.worldId);
  const beatSec = 60 / world.bpm;
  const beat = step / 4;
  const barIndex = Math.floor(step / 16);
  const stepInBar = step % 16;
  const section = sectionForBar(barIndex);
  const when = takeStart + beat * beatSec;

  if (section === "end") {
    tension = decayTension(tension, beat - lastTensionBeat);
    lastTensionBeat = beat;
    currentChord = tonicChordForScale(layout.scaleId);
    scheduleAnswerAtBoundary(beat, when, section);
    return;
  }

  const resolving = beat >= pendingResolutionBeat;
  if (stepInBar === 0) {
    tension = decayTension(tension, beat - lastTensionBeat);
    lastTensionBeat = beat;
    currentChord = resolving
      ? tonicChordForScale(layout.scaleId)
      : chordForBar(layout.scaleId, barIndex, tension);
    synth.schedulePad(currentChord, when, beatSec * 4, tension, { octaveLayer: section === "b" });
  }

  scheduleAnswerAtBoundary(beat, when, section);

  const currentTension = decayTension(tension, beat - lastTensionBeat);
  const silenceBeats = beat - lastPressBeat;
  if (beat >= resolutionReverbUntilBeat) {
    synth.setReverbSend(reverbSendFromSilence(silenceBeats), when);
  }

  if (resolving) {
    currentChord = tonicChordForScale(layout.scaleId);
    if (stepInBar !== 0) synth.schedulePad(currentChord, when, beatSec * (4 - (beat % 4)), tension);
    synth.scheduleResolution(layout.rootMidi, when);
    pendingResolutionBeat = Infinity;
    resolutionReverbUntilBeat = beat + 2;
  }

  if (kickForStep(section, stepInBar)) synth.scheduleKick(when);
  const bassGain = bassGainForStep(layout.worldId, section, stepInBar);
  if (bassGain !== null) {
    synth.scheduleBass(rootMidiForChord(layout.worldId, layout.scaleId, currentChord), when, beatSec * 0.45, bassGain);
  }
  if (snareForStep(section, stepInBar)) {
    synth.scheduleSnare(when);
  }
  if ((section === "a" || section === "b") && silenceBeats < 8) {
    const hat = hatForStep(currentTension, stepInBar);
    if (hat) {
      const swing = hatSwingSeconds(layout.worldId, stepInBar, beatSec);
      synth.scheduleHat(when + swing, hat === "open");
    }
  }
}

function scheduleAhead() {
  if (!audioContext || (phase !== "count-in" && phase !== "playing")) return;
  while (nextStep <= BARS * 16) {
    const stepTime = takeStart + (nextStep / 4) * synth.beatSec;
    if (stepTime > audioContext.currentTime + LOOKAHEAD_SEC) break;
    scheduleAccompanimentStep(nextStep);
    nextStep += 1;
  }
}

function clearTiming() {
  clearInterval(schedulerTimer);
  clearTimeout(finishTimer);
  clearTimeout(tailTimer);
  schedulerTimer = undefined;
  finishTimer = undefined;
  tailTimer = undefined;
  clearTimeout(answerTimer);
  answerTimer = undefined;
  scheduledAnswerTimers.forEach(clearTimeout);
  scheduledAnswerTimers = [];
  elements.answer.textContent = "";
}

async function closeAudio() {
  clearTiming();
  const context = audioContext;
  audioContext = undefined;
  synth = undefined;
  if (context && context.state !== "closed") await context.close();
}

function markTakeFinished() {
  clearInterval(schedulerTimer);
  schedulerTimer = undefined;
  phase = "finished";
  elements.status.textContent = "演奏終了";
  setControls();
  tailTimer = setTimeout(() => closeAudio(), 100);
}

async function startTake() {
  await closeAudio();
  rebuildLayout();
  const world = getWorld(layout.worldId);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioContextClass();
  await audioContext.resume();
  synth = createSynth(audioContext, { worldId: layout.worldId, scaleId: layout.scaleId, bpm: world.bpm, seed: layout.seed });
  const countInStart = audioContext.currentTime + 0.08;
  takeStart = countInStart + synth.beatSec * 4;
  takeEnd = takeStart + synth.beatSec * BARS * 4;
  for (let beat = 0; beat < 4; beat += 1) synth.scheduleClick(countInStart + beat * synth.beatSec, beat === 0);

  tension = 0;
  lastTensionBeat = 0;
  lastPressBeat = 0;
  lastPhysicalPressTime = -Infinity;
  lastPressEvent = null;
  answerCount = 0;
  currentChord = tonicChordForScale(layout.scaleId);
  pendingResolutionBeat = Infinity;
  resolutionReverbUntilBeat = -Infinity;
  nextStep = 0;
  takeLog = {
    version: "gravity-v0.2",
    worldId: layout.worldId,
    scaleId: layout.scaleId,
    seed: layout.seed,
    bpm: world.bpm,
    bars: BARS,
    quantize: selectedQuantize(),
    events: [],
  };
  phase = "count-in";
  elements.status.textContent = "カウントイン";
  setControls();
  schedulerTimer = setInterval(scheduleAhead, SCHEDULER_INTERVAL_MS);
  scheduleAhead();
  synth.scheduleEnding(takeEnd);
  finishTimer = setTimeout(markTakeFinished, Math.max(0, (takeEnd + 4 - audioContext.currentTime) * 1000));
}

async function stopTake() {
  const wasActive = phase === "count-in" || phase === "playing" || phase === "replay";
  await closeAudio();
  if (wasActive) {
    phase = "stopped";
    elements.status.textContent = "停止";
    setControls();
  }
}

async function replayTake() {
  if (!takeLog) return;
  await closeAudio();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioContextClass();
  await audioContext.resume();
  synth = createSynth(audioContext, { worldId: takeLog.worldId, scaleId: takeLog.scaleId, bpm: takeLog.bpm, seed: takeLog.seed });
  const replayStart = audioContext.currentTime + 0.08;
  scheduleRecordedTake(audioContext, synth, takeLog, replayStart);
  takeLog.events.filter((event) => event.kind === "answer").forEach((event) => {
    scheduleAnswerDisplay(event.degree, (replayStart + event.time - audioContext.currentTime) * 1000);
  });
  phase = "replay";
  elements.status.textContent = "再演中";
  setControls();
  const duration = takeLog.bars * 4 * 60 / takeLog.bpm + 4;
  finishTimer = setTimeout(async () => {
    await closeAudio();
    phase = "finished";
    elements.status.textContent = "再演終了";
    setControls();
  }, duration * 1000);
}

function handleKeyDown(event) {
  if (event.code === "Enter") {
    if (phase === "count-in" || phase === "playing" || phase === "replay") {
      event.preventDefault();
      stopTake();
    }
    return;
  }
  if (event.repeat || !layout?.keys[event.code] || !audioContext) return;
  if (audioContext.currentTime < takeStart || audioContext.currentTime >= takeEnd) return;
  if (phase === "count-in") phase = "playing";
  if (phase !== "playing") return;

  event.preventDefault();
  const assignment = layout.keys[event.code];
  const now = audioContext.currentTime;
  const scheduledTime = takeLog.quantize.enabled
    ? quantize(now, takeStart, synth.bpm, takeLog.quantize.division, 0.03)
    : now;
  const beat = (scheduledTime - takeStart) / synth.beatSec;
  const interval = now - lastPhysicalPressTime;
  const silenceBeforePress = beat - lastPressBeat;
  const section = sectionForBar(Math.floor(beat / 4));
  const accent = accentForBeat(beat % 4);
  const chordWeight = chordToneWeight(chordDegreeNotes(layout.scaleId, currentChord), assignment.degree);
  const returnGain = silenceBeforePress >= 4 ? 1.2 : 1;
  const returnLength = silenceBeforePress >= 4 ? 1.5 : 1;
  const velocity = velocityFromInterval(interval) * accent.gain * chordWeight.gain * returnGain;
  const length = noteLengthFromInterval(interval) * accent.length * chordWeight.length * returnLength;
  const deltaBeats = Math.max(0, beat - lastTensionBeat);
  const previousTension = decayTension(tension, deltaBeats);
  const nextTension = updateTension(tension, deltaBeats, assignment.role, layout.scaleId);
  const resolution = isResolution(previousTension, nextTension, assignment.role);

  tension = nextTension;
  lastTensionBeat = beat;
  lastPressBeat = beat;
  lastPhysicalPressTime = now;
  if (resolution) pendingResolutionBeat = Math.floor(beat) + 1;
  synth.setReverbSend(0.2, scheduledTime, synth.beatSec * 0.5);
  synth.scheduleLead(assignment, scheduledTime, length, velocity, assignment.effect, nextTension, {
    cutoffMinimum: section === "b" ? 1800 : 1200,
  });

  const loggedEvent = {
    time: scheduledTime - takeStart,
    beat,
    kind: "press",
    code: event.code,
    midi: assignment.midi,
    degree: assignment.degree,
    role: assignment.role,
    effect: assignment.effect,
    velocity,
    length,
    tBefore: previousTension,
    tAfter: nextTension,
    resolution,
    sourceId: "keyboard",
    section,
  };
  takeLog.events.push(loggedEvent);
  lastPressEvent = loggedEvent;
  setKeyPressed(event.code, true);
  setTimeout(() => setKeyPressed(event.code, false), Math.max(80, length * 1000));
}

function updateDisplay() {
  if (audioContext && (phase === "count-in" || phase === "playing")) {
    if (audioContext.currentTime >= takeStart && phase === "count-in") {
      phase = "playing";
      elements.status.textContent = "演奏中";
    }
    if (audioContext.currentTime >= takeStart) {
      const beat = Math.max(0, Math.min(BARS * 4, (audioContext.currentTime - takeStart) / synth.beatSec));
      if (beat >= BARS * 4) currentChord = tonicChordForScale(layout.scaleId);
      const displayedTension = decayTension(tension, Math.max(0, beat - lastTensionBeat));
      const bar = Math.min(BARS, Math.floor(beat / 4) + 1);
      const beatInBar = Math.min(4, Math.floor(beat % 4) + 1);
      elements.tension.value = displayedTension * 100;
      elements.tensionValue.textContent = String(Math.round(displayedTension * 100));
      elements.position.textContent = `${bar} / ${BARS} 小節・${beatInBar} 拍`;
      const section = sectionForBar(Math.min(BARS, Math.floor(beat / 4)));
      elements.section.textContent = section === "outro-last" ? "outro" : section;
    }
  }
  elements.chord.textContent = currentChord;
  elements.eventCount.textContent = String(takeLog?.events.length ?? 0);
  requestAnimationFrame(updateDisplay);
}

elements.world.addEventListener("change", rebuildLayout);
elements.seed.addEventListener("change", rebuildLayout);
elements.quantize.addEventListener("change", updateQuantizeDisplay);
elements.reroll.addEventListener("click", () => {
  elements.seed.value = String(newSeed());
  rebuildLayout();
});
elements.start.addEventListener("click", () => startTake().catch(showError));
elements.stop.addEventListener("click", () => stopTake().catch(showError));
elements.replay.addEventListener("click", () => replayTake().catch(showError));
elements.json.addEventListener("click", () => takeLog && downloadTakeJson(takeLog));
elements.wav.addEventListener("click", async () => {
  if (!takeLog) return;
  elements.status.textContent = "WAV生成中";
  elements.wav.disabled = true;
  try {
    await downloadTakeWav(takeLog);
    elements.status.textContent = "WAV書き出し完了";
  } catch (error) {
    showError(error);
  } finally {
    setControls();
  }
});
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => setKeyPressed(event.code, false));

function showError(error) {
  console.error(error);
  elements.status.textContent = `エラー: ${error.message}`;
}

elements.seed.value = String(newSeed());
rebuildLayout();
updateQuantizeDisplay();
setControls();
updateDisplay();
