import {
  accentForBeat,
  answerDegree,
  bassGainForStep,
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
  tonicChordForWorld,
  updateTension,
  velocityFromInterval,
} from "../prototype/gravity.mjs";
import { downloadTakeJson } from "../prototype/render.js";
import { createSynth } from "../prototype/synth.js";
import { downloadTakeMidi } from "./midi.js";
import { downloadMixWav, downloadStems } from "./stems.js";
import { formatParams, parseParams, rowOffsetPx, transition } from "./ui-core.mjs";
import { createTerrain } from "./terrain.js";

const PERFORMANCE = Object.freeze({
  bars: 16,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  lookaheadSeconds: 0.1,
  schedulerIntervalMs: 25,
  audioLeadSeconds: 0.08,
  audioTailSeconds: 4,
  answerVisibleMs: 1000,
});
const KEY_ROWS = Object.freeze(["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]);
const ROLE_MARKS = Object.freeze({ stable: "●", floating: "◐", tension: "▲" });
const EFFECT_LABELS = Object.freeze({ none: "—", delay: "dly", sweep: "swp", octave: "oct", stutter: "stt" });
const FORM_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

const elements = {
  answer: document.querySelector("#answer"),
  chord: document.querySelector("#chord"),
  content: document.querySelector("#content"),
  countin: document.querySelector("#countin"),
  finishedPanel: document.querySelector("#finished-panel"),
  finishReroll: document.querySelector("#finish-reroll"),
  exportStatus: document.querySelector("#export-status"),
  json: document.querySelector("#json"),
  keyboard: document.querySelector("#keyboard"),
  primary: document.querySelector("#primary-action"),
  quantize: document.querySelector("#quantize"),
  reroll: document.querySelector("#reroll"),
  retake: document.querySelector("#retake"),
  seed: document.querySelector("#seed"),
  settings: document.querySelector("#settings"),
  shareLink: document.querySelector("#share-link"),
  statusLabel: document.querySelector("#status-label"),
  statusPosition: document.querySelector("#status-position"),
  statusSection: document.querySelector("#status-section"),
  statusSeed: document.querySelector("#status-seed"),
  statusWorld: document.querySelector("#status-world"),
  takeSummary: document.querySelector("#take-summary"),
  tensionFill: document.querySelector("#tension-fill"),
  stems: document.querySelector("#stems"),
  midi: document.querySelector("#midi"),
  wav: document.querySelector("#wav"),
  world: document.querySelector("#world"),
};

const terrain = createTerrain(document.querySelector("#terrain"));
const narrowScreen = window.matchMedia("(max-width: 599.98px)");

let state = "idle";
let layout;
let audioContext;
let synth;
let schedulerTimer;
let finishTimer;
let tailTimer;
let answerTimer;
let scheduledAnswerTimers = [];
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
let lastPressEvent;
let answerCount = 0;
let takeLog;

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0].toString(16).padStart(8, "0").slice(0, 6);
}

function normalizedSeed() {
  const raw = elements.seed.value.trim();
  if (!raw) return randomSeed();
  return /^[+-]?\d+$/.test(raw) ? Number(raw) : raw;
}

function selectedQuantize() {
  const division = { 4: 1, 8: 2, 16: 4 }[elements.quantize.value] ?? null;
  return { enabled: division !== null, division };
}

function updateUrl() {
  history.replaceState(null, "", formatParams({ world: elements.world.value, seed: elements.seed.value }));
}

function renderLayout() {
  elements.keyboard.replaceChildren();
  const keySize = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--key-size"));
  KEY_ROWS.forEach((letters, rowIndex) => {
    const row = document.createElement("div");
    row.className = "key-row";
    row.style.marginLeft = `${rowOffsetPx(rowIndex, keySize)}px`;
    for (const letter of letters) {
      const code = `Key${letter}`;
      const assignment = layout.keys[code];
      const key = document.createElement("button");
      key.type = "button";
      key.className = `key key-${assignment.role}`;
      key.dataset.code = code;
      key.setAttribute("aria-label", `${letter}、度数${assignment.degree}、${assignment.role}、${assignment.effect}`);
      key.innerHTML = `<span class="key-degree">${assignment.degree}</span><span class="key-meta">${ROLE_MARKS[assignment.role]} ${EFFECT_LABELS[assignment.effect]}</span>`;
      key.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        playCode(code, "pointer");
      });
      row.append(key);
    }
    elements.keyboard.append(row);
  });
}

function rebuildLayout({ replaceUrl = true } = {}) {
  layout = createLayout(normalizedSeed(), elements.world.value);
  elements.seed.value = String(layout.seed);
  document.documentElement.dataset.world = layout.worldId;
  currentChord = tonicChordForWorld(layout.worldId);
  terrain.setWorld();
  renderLayout();
  if (replaceUrl) updateUrl();
  renderState();
}

function clearTimers() {
  clearInterval(schedulerTimer);
  clearTimeout(finishTimer);
  clearTimeout(tailTimer);
  clearTimeout(answerTimer);
  scheduledAnswerTimers.forEach(clearTimeout);
  schedulerTimer = undefined;
  finishTimer = undefined;
  tailTimer = undefined;
  answerTimer = undefined;
  scheduledAnswerTimers = [];
  elements.answer.textContent = "";
}

async function closeAudio() {
  clearTimers();
  const context = audioContext;
  audioContext = undefined;
  synth = undefined;
  if (context && context.state !== "closed") await context.close();
}

function renderState() {
  const active = state === "countin" || state === "playing";
  const finished = state === "finished";
  elements.finishedPanel.hidden = !finished;
  for (const control of elements.settings.elements) control.disabled = state !== "idle";
  elements.primary.disabled = state === "idle" && narrowScreen.matches;
  elements.primary.textContent = active ? "停止 (Enter)" : finished ? "もう1テイク" : "演奏開始";
  elements.statusLabel.textContent = state === "idle" ? "待機" : state === "countin" ? "カウントイン" : state === "playing" ? "演奏中" : "テイク完了";
  elements.statusWorld.textContent = `世界 ${layout?.worldId ?? elements.world.value}`;
  elements.statusSeed.textContent = `seed ${layout?.seed ?? elements.seed.value}`;
  elements.statusPosition.textContent = active ? " 1/16小節" : "";
  elements.statusSection.textContent = active ? " intro" : "";
  elements.chord.textContent = currentChord;
  if (active) {
    document.activeElement?.blur?.();
    document.body.focus({ preventScroll: true });
  }
  if (finished && takeLog) updateFinishedPanel();
}

function dispatch(type) {
  state = transition(state, type);
  renderState();
}

function updateFinishedPanel() {
  const seconds = PERFORMANCE.bars * PERFORMANCE.beatsPerBar * 60 / takeLog.bpm;
  const presses = takeLog.events.filter((event) => event.kind === "press").length;
  elements.takeSummary.textContent = `${seconds.toFixed(1)}秒・${PERFORMANCE.bars}小節・打鍵 ${presses}`;
  elements.shareLink.textContent = `共有リンク: ${formatParams({ world: takeLog.worldId, seed: takeLog.seed })}（配置だけを共有。テイクはWAV/JSONで）`;
}

function showAnswer(degree) {
  clearTimeout(answerTimer);
  elements.answer.textContent = `応答: 度数${degree}`;
  terrain.answer();
  answerTimer = setTimeout(() => { elements.answer.textContent = ""; }, PERFORMANCE.answerVisibleMs);
}

function scheduleAnswerDisplay(degree, delayMs) {
  const timer = setTimeout(() => showAnswer(degree), Math.max(0, delayMs));
  scheduledAnswerTimers.push(timer);
}

function rootMidiForChord(worldId, chordName) {
  return chordRootMidi(worldId, chordName, 2);
}

function scheduleAnswerAtBoundary(beat, when, section) {
  if (beat === 0 || beat % 8 !== 0 || answerCount >= 8 || !lastPressEvent) return;
  if (lastPressEvent.beat < beat - 1 || lastPressEvent.beat >= beat || lastPressEvent.role === "stable") return;
  const degree = answerDegree(layout.worldId, lastPressEvent.degree, currentChord);
  const event = {
    time: when - takeStart,
    beat,
    kind: "answer",
    code: null,
    midi: midiForDegree(layout.worldId, degree, 0),
    degree,
    role: roleForDegree(layout.worldId, degree),
    effect: "none",
    velocity: 0.45,
    length: 0.6,
    tBefore: tension,
    tAfter: tension,
    resolution: false,
    sourceId: "gravity",
    section,
  };
  synth.scheduleLead(event, when, event.length, event.velocity, "none", tension, { cutoffMinimum: section === "b" ? 1800 : 1200 });
  takeLog.events.push(event);
  answerCount += 1;
  scheduleAnswerDisplay(degree, (when - audioContext.currentTime) * 1000);
}

function scheduleAccompanimentStep(step) {
  const world = getWorld(layout.worldId);
  const beat = step / PERFORMANCE.stepsPerBeat;
  const barIndex = Math.floor(step / (PERFORMANCE.stepsPerBeat * PERFORMANCE.beatsPerBar));
  const stepInBar = step % (PERFORMANCE.stepsPerBeat * PERFORMANCE.beatsPerBar);
  const section = sectionForBar(barIndex);
  const when = takeStart + beat * synth.beatSec;

  if (section === "end") {
    tension = decayTension(tension, beat - lastTensionBeat);
    lastTensionBeat = beat;
    currentChord = tonicChordForWorld(layout.worldId);
    scheduleAnswerAtBoundary(beat, when, section);
    return;
  }

  const resolving = beat >= pendingResolutionBeat;
  if (stepInBar === 0) {
    tension = decayTension(tension, beat - lastTensionBeat);
    lastTensionBeat = beat;
    currentChord = resolving ? tonicChordForWorld(layout.worldId) : chordForBar(layout.worldId, barIndex, tension);
    synth.schedulePad(currentChord, when, synth.beatSec * PERFORMANCE.beatsPerBar, tension, { octaveLayer: section === "b" });
  }

  scheduleAnswerAtBoundary(beat, when, section);
  const currentTension = decayTension(tension, beat - lastTensionBeat);
  const silenceBeats = beat - lastPressBeat;
  if (beat >= resolutionReverbUntilBeat) synth.setReverbSend(reverbSendFromSilence(silenceBeats), when);

  if (resolving) {
    currentChord = tonicChordForWorld(layout.worldId);
    if (stepInBar !== 0) synth.schedulePad(currentChord, when, synth.beatSec * (PERFORMANCE.beatsPerBar - (beat % PERFORMANCE.beatsPerBar)), tension);
    synth.scheduleResolution(world.rootMidi, when);
    pendingResolutionBeat = Infinity;
    resolutionReverbUntilBeat = beat + 2;
    scheduleVisualAt(when, () => {
      terrain.bloom();
      elements.chord.classList.add("resolution");
      setTimeout(() => elements.chord.classList.remove("resolution"), synth?.beatSec * 1000 || 0);
    });
  }

  if (kickForStep(section, stepInBar)) synth.scheduleKick(when);
  const bassGain = bassGainForStep(layout.worldId, section, stepInBar);
  if (bassGain !== null) synth.scheduleBass(rootMidiForChord(layout.worldId, currentChord), when, synth.beatSec * 0.45, bassGain);
  if (snareForStep(section, stepInBar)) synth.scheduleSnare(when);
  if ((section === "a" || section === "b") && silenceBeats < 8) {
    const hat = hatForStep(currentTension, stepInBar);
    if (hat) synth.scheduleHat(when + hatSwingSeconds(layout.worldId, stepInBar, synth.beatSec), hat === "open");
  }
}

function scheduleVisualAt(when, callback) {
  const timer = setTimeout(callback, Math.max(0, (when - audioContext.currentTime) * 1000));
  scheduledAnswerTimers.push(timer);
}

function scheduleAhead() {
  if (!audioContext || !synth || (state !== "countin" && state !== "playing")) return;
  const finalStep = PERFORMANCE.bars * PERFORMANCE.beatsPerBar * PERFORMANCE.stepsPerBeat;
  while (nextStep <= finalStep) {
    const stepTime = takeStart + (nextStep / PERFORMANCE.stepsPerBeat) * synth.beatSec;
    if (stepTime > audioContext.currentTime + PERFORMANCE.lookaheadSeconds) break;
    scheduleAccompanimentStep(nextStep);
    nextStep += 1;
  }
}

async function beginTake(eventType) {
  await closeAudio();
  elements.exportStatus.textContent = "";
  if (eventType === "START") rebuildLayout();
  const nextState = transition(state, eventType);
  const world = getWorld(layout.worldId);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザはWeb Audio APIに対応していません");
  audioContext = new AudioContextClass();
  await audioContext.resume();
  synth = createSynth(audioContext, { worldId: layout.worldId, bpm: world.bpm, seed: layout.seed });
  state = nextState;
  const countInStart = audioContext.currentTime + PERFORMANCE.audioLeadSeconds;
  takeStart = countInStart + synth.beatSec * PERFORMANCE.beatsPerBar;
  takeEnd = takeStart + synth.beatSec * PERFORMANCE.bars * PERFORMANCE.beatsPerBar;
  for (let beat = 0; beat < PERFORMANCE.beatsPerBar; beat += 1) {
    synth.scheduleClick(countInStart + beat * synth.beatSec, beat === 0);
  }

  tension = 0;
  lastTensionBeat = 0;
  lastPressBeat = 0;
  lastPhysicalPressTime = -Infinity;
  lastPressEvent = undefined;
  answerCount = 0;
  currentChord = tonicChordForWorld(layout.worldId);
  pendingResolutionBeat = Infinity;
  resolutionReverbUntilBeat = -Infinity;
  nextStep = 0;
  takeLog = {
    version: "gravity-v0.2",
    worldId: layout.worldId,
    seed: layout.seed,
    bpm: world.bpm,
    bars: PERFORMANCE.bars,
    quantize: selectedQuantize(),
    events: [],
  };
  terrain.setTension(0);
  renderState();
  schedulerTimer = setInterval(scheduleAhead, PERFORMANCE.schedulerIntervalMs);
  scheduleAhead();
  synth.scheduleEnding(takeEnd);
  finishTimer = setTimeout(markTakeFinished, Math.max(0, (takeEnd - audioContext.currentTime) * 1000));
}

function markTakeFinished() {
  clearInterval(schedulerTimer);
  schedulerTimer = undefined;
  dispatch("TAKE_COMPLETE");
  terrain.end();
  tailTimer = setTimeout(() => closeAudio().catch(showError), PERFORMANCE.audioTailSeconds * 1000);
}

async function stopTake() {
  if (state !== "countin" && state !== "playing") return;
  await closeAudio();
  dispatch("STOP");
  terrain.end();
}

function setKeyPressed(code, pressed) {
  elements.keyboard.querySelector(`[data-code="${code}"]`)?.classList.toggle("pressed", pressed);
}

function cssDurationMs(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw.endsWith("ms") ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
}

function playCode(code, sourceId = "keyboard") {
  if (state !== "playing" || !audioContext || !layout?.keys[code]) return;
  if (audioContext.currentTime < takeStart || audioContext.currentTime >= takeEnd) return;
  const assignment = layout.keys[code];
  const now = audioContext.currentTime;
  const scheduledTime = takeLog.quantize.enabled
    ? quantize(now, takeStart, synth.bpm, takeLog.quantize.division, 0.03)
    : now;
  const beat = (scheduledTime - takeStart) / synth.beatSec;
  const interval = now - lastPhysicalPressTime;
  const silenceBeforePress = beat - lastPressBeat;
  const section = sectionForBar(Math.floor(beat / PERFORMANCE.beatsPerBar));
  const accent = accentForBeat(beat % PERFORMANCE.beatsPerBar);
  const chordWeight = chordToneWeight(getWorld(layout.worldId).chords[currentChord], assignment.degree);
  const returnGain = silenceBeforePress >= 4 ? 1.2 : 1;
  const returnLength = silenceBeforePress >= 4 ? 1.5 : 1;
  const velocity = velocityFromInterval(interval) * accent.gain * chordWeight.gain * returnGain;
  const length = noteLengthFromInterval(interval) * accent.length * chordWeight.length * returnLength;
  const deltaBeats = Math.max(0, beat - lastTensionBeat);
  const previousTension = decayTension(tension, deltaBeats);
  const nextTension = updateTension(tension, deltaBeats, assignment.role);
  const resolution = isResolution(previousTension, nextTension, assignment.role);

  tension = nextTension;
  lastTensionBeat = beat;
  lastPressBeat = beat;
  lastPhysicalPressTime = now;
  if (resolution) pendingResolutionBeat = Math.floor(beat) + 1;
  synth.setReverbSend(0.2, scheduledTime, synth.beatSec * 0.5);
  synth.scheduleLead(assignment, scheduledTime, length, velocity, assignment.effect, nextTension, { cutoffMinimum: section === "b" ? 1800 : 1200 });

  const loggedEvent = {
    time: scheduledTime - takeStart,
    beat,
    kind: "press",
    code,
    midi: assignment.midi,
    degree: assignment.degree,
    role: assignment.role,
    effect: assignment.effect,
    velocity,
    length,
    tBefore: previousTension,
    tAfter: nextTension,
    resolution,
    sourceId,
    section,
  };
  takeLog.events.push(loggedEvent);
  lastPressEvent = loggedEvent;
  const key = elements.keyboard.querySelector(`[data-code="${code}"]`);
  if (key) terrain.press(key.getBoundingClientRect(), assignment.role);
  setKeyPressed(code, true);
  setTimeout(() => setKeyPressed(code, false), cssDurationMs("--duration-press"));
}

function handleKeyDown(event) {
  if (FORM_TAGS.has(document.activeElement?.tagName)) return;
  if (event.code === "Enter") {
    if (state === "countin" || state === "playing") {
      event.preventDefault();
      stopTake().catch(showError);
    }
    return;
  }
  if (event.repeat || !layout?.keys[event.code]) return;
  if (state === "playing") {
    event.preventDefault();
    playCode(event.code);
  }
}

function updateDisplay() {
  if (audioContext && synth && (state === "countin" || state === "playing")) {
    const now = audioContext.currentTime;
    if (state === "countin") {
      const beatsLeft = Math.ceil((takeStart - now) / synth.beatSec);
      elements.countin.textContent = beatsLeft > 0 ? String(Math.min(PERFORMANCE.beatsPerBar, beatsLeft)) : "";
      if (now >= takeStart) dispatch("COUNTIN_COMPLETE");
    } else {
      elements.countin.textContent = "";
    }
    if (now >= takeStart) {
      const beat = Math.max(0, Math.min(PERFORMANCE.bars * PERFORMANCE.beatsPerBar, (now - takeStart) / synth.beatSec));
      const displayedTension = decayTension(tension, Math.max(0, beat - lastTensionBeat));
      const bar = Math.min(PERFORMANCE.bars, Math.floor(beat / PERFORMANCE.beatsPerBar) + 1);
      const section = sectionForBar(Math.min(PERFORMANCE.bars, Math.floor(beat / PERFORMANCE.beatsPerBar)));
      elements.statusPosition.textContent = ` ${bar}/${PERFORMANCE.bars}小節`;
      elements.statusSection.textContent = ` ${section === "outro-last" ? "outro" : section}`;
      elements.tensionFill.style.width = `${displayedTension * 100}%`;
      document.body.dataset.highTension = String(displayedTension >= 0.5);
      terrain.setTension(displayedTension);
    }
  } else {
    elements.countin.textContent = "";
    elements.tensionFill.style.width = "0%";
    document.body.dataset.highTension = "false";
  }
  elements.chord.textContent = currentChord;
  requestAnimationFrame(updateDisplay);
}

function showError(error) {
  console.error(error);
  elements.statusLabel.textContent = `エラー: ${error.message}`;
}

const exportButtons = [elements.wav, elements.stems, elements.midi, elements.json];

async function runExport(task) {
  exportButtons.forEach((button) => { button.disabled = true; });
  try {
    await task();
  } catch (error) {
    console.error(error);
    elements.exportStatus.textContent = `書き出しに失敗しました（${error.message}）`;
  } finally {
    exportButtons.forEach((button) => { button.disabled = false; });
  }
}

elements.primary.addEventListener("click", () => {
  if (state === "idle") beginTake("START").catch(showError);
  else if (state === "finished") beginTake("RETAKE").catch(showError);
  else stopTake().catch(showError);
});
elements.retake.addEventListener("click", () => beginTake("RETAKE").catch(showError));
elements.reroll.addEventListener("click", () => {
  elements.seed.value = randomSeed();
  rebuildLayout();
});
elements.finishReroll.addEventListener("click", () => {
  dispatch("REROLL");
  elements.seed.value = randomSeed();
  rebuildLayout();
});
elements.world.addEventListener("change", () => rebuildLayout());
elements.seed.addEventListener("change", () => rebuildLayout());
elements.json.addEventListener("click", () => {
  if (!takeLog) return;
  runExport(async () => {
    elements.exportStatus.textContent = "JSONを書き出し中…";
    downloadTakeJson(takeLog);
    elements.exportStatus.textContent = "JSONを書き出しました";
  });
});
elements.wav.addEventListener("click", () => {
  if (!takeLog) return;
  runExport(async () => {
    elements.exportStatus.textContent = "WAVをレンダー中…";
    await downloadMixWav(takeLog);
    elements.exportStatus.textContent = "WAVを書き出しました";
  });
});
elements.stems.addEventListener("click", () => {
  if (!takeLog) return;
  runExport(async () => {
    await downloadStems(takeLog, ({ index, total }) => {
      elements.exportStatus.textContent = `ステム ${index}/${total} をレンダー中…`;
    });
    elements.exportStatus.textContent = "ステム3本を書き出しました";
  });
});
elements.midi.addEventListener("click", () => {
  if (!takeLog) return;
  runExport(async () => {
    elements.exportStatus.textContent = "MIDIを書き出し中…";
    downloadTakeMidi(takeLog);
    elements.exportStatus.textContent = "MIDIを書き出しました";
  });
});
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => setKeyPressed(event.code, false));
window.addEventListener("resize", () => renderLayout());
narrowScreen.addEventListener("change", renderState);

const initial = parseParams(location.search);
elements.world.value = initial.world;
elements.seed.value = initial.seed || randomSeed();
rebuildLayout();
renderState();
updateDisplay();
