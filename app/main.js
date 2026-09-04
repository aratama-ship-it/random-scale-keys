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
import { downloadTakeJson, scheduleRecordedTake } from "../prototype/render.js";
import { createSynth } from "../prototype/synth.js";
import { downloadTakeMidi } from "./midi.js";
import { detectFormat, sceneToEvents } from "./scene-map.mjs";
import { downloadMixWav, downloadStems } from "./stems.js";
import {
  diagnosticDisabledForState,
  formatParams,
  parseParams,
  pressTracker,
  rowOffsetPx,
  transition,
  validateTakeLog,
} from "./ui-core.mjs";
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
  diagnosticDurationMs: 3000,
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
  diagnose: document.querySelector("#diagnose"),
  diagnosticClose: document.querySelector("#diagnostic-close"),
  diagnosticMessage: document.querySelector("#diagnostic-message"),
  diagnosticNote: document.querySelector("#diagnostic-note"),
  diagnosticPanel: document.querySelector("#diagnostic-panel"),
  finishedPanel: document.querySelector("#finished-panel"),
  finishReroll: document.querySelector("#finish-reroll"),
  exportStatus: document.querySelector("#export-status"),
  json: document.querySelector("#json"),
  keyboard: document.querySelector("#keyboard"),
  primary: document.querySelector("#primary-action"),
  quantize: document.querySelector("#quantize"),
  reroll: document.querySelector("#reroll"),
  retake: document.querySelector("#retake"),
  replay: document.querySelector("#replay"),
  seed: document.querySelector("#seed"),
  scenePlay: document.querySelector("#scene-play"),
  sceneSummary: document.querySelector("#scene-summary"),
  settings: document.querySelector("#settings"),
  shareLink: document.querySelector("#share-link"),
  statusLabel: document.querySelector("#status-label"),
  statusPosition: document.querySelector("#status-position"),
  statusSection: document.querySelector("#status-section"),
  statusSeed: document.querySelector("#status-seed"),
  statusWorld: document.querySelector("#status-world"),
  takeSummary: document.querySelector("#take-summary"),
  takeFile: document.querySelector("#take-file"),
  loadError: document.querySelector("#load-error"),
  loadedTake: document.querySelector("#loaded-take"),
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
let loadedTakeFilename = "";
let loadedSceneSummary = "";
let diagnosticActive = false;
let diagnosticKeys;
let diagnosticTimer;
const keyRects = new Map();

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

function normalizedSeed() {
  const raw = elements.seed.value.trim();
  if (!raw) return randomSeed();
  return /^[+-]?\d+$/.test(raw) ? Number(raw) : randomSeed();
}

function selectedQuantize() {
  const division = { 4: 1, 8: 2, 16: 4 }[elements.quantize.value] ?? null;
  return { enabled: division !== null, division };
}

function updateUrl() {
  history.replaceState(null, "", formatParams({ world: elements.world.value, seed: elements.seed.value }));
}

function cssNumber(name) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

function updateContourGeometry() {
  if (!layout) return;
  keyRects.clear();
  const renderedKeys = [...elements.keyboard.querySelectorAll("[data-code]")];
  const visibleKeys = renderedKeys.filter((key) => key.getBoundingClientRect().width > 0);

  if (visibleKeys.length) {
    visibleKeys.forEach((key) => keyRects.set(key.dataset.code, key.getBoundingClientRect()));
  } else {
    const keySize = cssNumber("--key-size");
    const keyGap = cssNumber("--key-gap");
    const bottom = window.innerHeight - cssNumber("--space-4");
    const top = bottom - KEY_ROWS.length * keySize - (KEY_ROWS.length - 1) * keyGap;
    const widestWidth = KEY_ROWS[0].length * keySize + (KEY_ROWS[0].length - 1) * keyGap;
    KEY_ROWS.forEach((letters, rowIndex) => {
      const rowLeft = (window.innerWidth - widestWidth) / 2 + rowOffsetPx(rowIndex, keySize);
      const rowTop = top + rowIndex * (keySize + keyGap);
      [...letters].forEach((letter, columnIndex) => {
        keyRects.set(`Key${letter}`, {
          left: rowLeft + columnIndex * (keySize + keyGap),
          top: rowTop,
          width: keySize,
          height: keySize,
        });
      });
    });
  }

  const sources = [...keyRects].map(([code, rect]) => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    role: layout.keys[code].role,
  }));
  const top = document.querySelector(".topbar").getBoundingClientRect().bottom;
  const bottom = Math.max(top, ...[...keyRects.values()].map((rect) => rect.top + rect.height));
  terrain.setContours(sources, { top, bottom });
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
  requestAnimationFrame(updateContourGeometry);
}

function rebuildLayout({ replaceUrl = true, imported = false } = {}) {
  layout = createLayout(normalizedSeed(), elements.world.value);
  elements.seed.value = String(layout.seed);
  document.documentElement.dataset.world = layout.worldId;
  document.body.dataset.imported = String(imported);
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
  const active = state === "countin" || state === "playing" || state === "replay";
  const finished = state === "finished";
  const panelVisible = finished || state === "replay";
  elements.finishedPanel.hidden = !panelVisible;
  for (const control of elements.settings.elements) control.disabled = state !== "idle";
  elements.diagnose.disabled = diagnosticDisabledForState(state);
  elements.primary.disabled = (state === "idle" || state === "finished") && narrowScreen.matches;
  elements.primary.textContent = active ? "停止 (Enter)" : finished ? "もう1テイク" : "演奏開始";
  elements.statusLabel.textContent = state === "idle" ? "待機" : state === "countin" ? "カウントイン" : state === "playing" ? "演奏中" : state === "replay" ? "再生中" : "テイク完了";
  elements.statusWorld.textContent = `世界 ${layout?.worldId ?? elements.world.value}`;
  elements.statusSeed.textContent = `seed ${layout?.seed ?? elements.seed.value}`;
  elements.statusPosition.textContent = active ? " 1/16小節" : "";
  elements.statusSection.textContent = active ? " intro" : "";
  elements.chord.textContent = currentChord;
  if (active) {
    document.activeElement?.blur?.();
    document.body.focus({ preventScroll: true });
  }
  const panelButtons = [...exportButtons, elements.retake, elements.finishReroll, elements.replay];
  panelButtons.forEach((button) => { button.disabled = state === "replay"; });
  if (narrowScreen.matches) elements.retake.disabled = true;
  if (panelVisible && takeLog) updateFinishedPanel();
  requestAnimationFrame(updateContourGeometry);
}

function dispatch(type) {
  state = transition(state, type);
  renderState();
}

function updateFinishedPanel() {
  const seconds = takeLog.bars * PERFORMANCE.beatsPerBar * 60 / takeLog.bpm;
  const presses = takeLog.events.filter((event) => event.kind === "press").length;
  elements.takeSummary.textContent = `${seconds.toFixed(1)}秒・${takeLog.bars}小節・打鍵 ${presses}`;
  elements.loadedTake.hidden = !loadedTakeFilename;
  const loadedKind = loadedSceneSummary ? "シーン" : "テイク";
  elements.loadedTake.textContent = loadedTakeFilename ? `読み込んだ${loadedKind}: ${loadedTakeFilename}` : "";
  elements.sceneSummary.hidden = !loadedSceneSummary;
  elements.sceneSummary.textContent = loadedSceneSummary;
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
  closeDiagnostic();
  await closeAudio();
  elements.exportStatus.textContent = "";
  if (eventType === "START") {
    loadedSceneSummary = "";
    rebuildLayout();
  }
  if (eventType === "RETAKE") {
    loadedTakeFilename = "";
    loadedSceneSummary = "";
    document.body.dataset.imported = "false";
    renderLayout();
  }
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
    version: "gravity-v0",
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

function codeForReplayEvent(event) {
  if (event.code && layout.keys[event.code]) return event.code;
  return Object.keys(layout.keys).find((code) => {
    const assignment = layout.keys[code];
    return assignment.midi === event.midi && assignment.degree === event.degree;
  });
}

function scheduleReplayVisuals() {
  takeLog.events.forEach((event) => {
    if (event.kind === "press" && event.resolution) {
      const resolutionBeat = Math.floor(event.beat) + 1;
      scheduleVisualAt(takeStart + resolutionBeat * synth.beatSec, () => {
        if (state === "replay") terrain.bloom();
      });
    }
    scheduleVisualAt(takeStart + event.time, () => {
      if (state !== "replay") return;
      if (event.kind === "answer") {
        showAnswer(event.degree);
        return;
      }
      if (event.kind !== "press") return;
      const code = codeForReplayEvent(event);
      const rect = code ? keyRects.get(code) : undefined;
      if (rect) terrain.press(rect, event.role);
      if (code) {
        setKeyPressed(code, true);
        setTimeout(() => setKeyPressed(code, false), cssDurationMs("--duration-press"));
      }
      tension = event.tAfter;
      lastTensionBeat = event.beat;
      terrain.setTension(tension);
    });
  });
}

function finishReplayNaturally() {
  if (state !== "replay") return;
  clearTimeout(finishTimer);
  finishTimer = undefined;
  dispatch("REPLAY_END");
  terrain.end();
  tailTimer = setTimeout(() => closeAudio().catch(showError), PERFORMANCE.audioTailSeconds * 1000);
}

async function beginReplay() {
  if (state !== "finished" || !takeLog) return;
  closeDiagnostic();
  await closeAudio();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザはWeb Audio APIに対応していません");
  audioContext = new AudioContextClass();
  await audioContext.resume();
  synth = createSynth(audioContext, { worldId: takeLog.worldId, bpm: takeLog.bpm, seed: takeLog.seed });
  state = transition(state, "REPLAY");
  takeStart = audioContext.currentTime + PERFORMANCE.audioLeadSeconds;
  takeEnd = takeStart + takeLog.bars * PERFORMANCE.beatsPerBar * synth.beatSec;
  tension = 0;
  lastTensionBeat = 0;
  currentChord = tonicChordForWorld(takeLog.worldId);
  terrain.setTension(0);
  scheduleRecordedTake(audioContext, synth, audibleTakeLog(takeLog), takeStart);
  scheduleReplayVisuals();
  finishTimer = setTimeout(finishReplayNaturally, Math.max(0, (takeEnd - audioContext.currentTime) * 1000));
  renderState();
}

async function stopReplay() {
  if (state !== "replay") return;
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
  if (diagnosticActive) {
    if (!event.repeat && event.code) diagnosticKeys.add(event.code);
    event.preventDefault();
    return;
  }
  if (FORM_TAGS.has(document.activeElement?.tagName)) return;
  if (event.code === "Enter") {
    if (state === "countin" || state === "playing") {
      event.preventDefault();
      stopTake().catch(showError);
    } else if (state === "replay") {
      event.preventDefault();
      stopReplay().catch(showError);
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
  if (audioContext && synth && (state === "countin" || state === "playing" || state === "replay")) {
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
      const replayBars = state === "replay" ? takeLog.bars : PERFORMANCE.bars;
      const replayBeat = Math.max(0, Math.min(replayBars * PERFORMANCE.beatsPerBar, (now - takeStart) / synth.beatSec));
      const shownBeat = state === "replay" ? replayBeat : beat;
      const shownTension = decayTension(tension, Math.max(0, shownBeat - lastTensionBeat));
      const shownBar = Math.min(replayBars, Math.floor(shownBeat / PERFORMANCE.beatsPerBar) + 1);
      const section = sectionForBar(Math.min(replayBars, Math.floor(shownBeat / PERFORMANCE.beatsPerBar)));
      elements.statusPosition.textContent = ` ${shownBar}/${replayBars}小節`;
      elements.statusSection.textContent = ` ${section === "outro-last" ? "outro" : section}`;
      elements.tensionFill.style.width = `${shownTension * 100}%`;
      document.body.dataset.highTension = String(shownTension >= 0.5);
      terrain.setTension(shownTension);
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

function normalizeLoadedLog(log) {
  return {
    ...log,
    events: log.events.map((event) => ({
      ...event,
      effect: typeof event.effect === "string" ? event.effect : "none",
      tBefore: Number.isFinite(event.tBefore) ? event.tBefore : 0,
      tAfter: Number.isFinite(event.tAfter) ? event.tAfter : 0,
      resolution: event.resolution === true,
      sourceId: typeof event.sourceId === "string" ? event.sourceId : "gravity",
      section: typeof event.section === "string" ? event.section : sectionForBar(Math.floor(event.beat / PERFORMANCE.beatsPerBar)),
    })),
  };
}

function audibleTakeLog(log) {
  return {
    ...log,
    events: log.events.filter((event) => event.kind === "press" || event.kind === "answer"),
  };
}

function motionSceneSummary(scene) {
  const pattern = scene.metadata?.pattern === "three_ball_cascade"
    ? "3ボールカスケード"
    : (scene.metadata?.title ?? scene.sceneId ?? "Motion Scene");
  const propCount = scene.metadata?.propCount ?? scene.props?.length ?? 0;
  return `ジャグリング: ${pattern}（${propCount}球・${scene.timeline.durationSeconds}秒を繰り返し）`;
}

function loadMotionScene(scene, filename = "") {
  const world = getWorld(elements.world.value);
  const seed = normalizedSeed();
  elements.seed.value = String(seed);
  takeLog = sceneToEvents(scene, {
    worldId: world.id,
    seed,
    bpm: world.bpm,
    bars: PERFORMANCE.bars,
    quantize: selectedQuantize(),
  });
  const validation = validateTakeLog(takeLog);
  if (!validation.ok) throw new Error(validation.reason);
  loadedTakeFilename = filename;
  loadedSceneSummary = motionSceneSummary(scene);
  state = "finished";
  rebuildLayout({ imported: true });
  elements.exportStatus.textContent = "";
}

async function loadBundledScene() {
  elements.loadError.textContent = "";
  try {
    const response = await fetch("./scenes/three-ball-cascade.json");
    if (!response.ok) throw new Error(`同梱シーンを取得できませんでした（HTTP ${response.status}）`);
    loadMotionScene(await response.json());
  } catch (error) {
    elements.loadError.textContent = `読み込めませんでした（${error.message}）`;
  }
}

async function loadTakeFile(file) {
  elements.loadError.textContent = "";
  try {
    const parsed = JSON.parse(await file.text());
    const format = detectFormat(parsed);
    if (format === "juggling-motion-scene") {
      loadMotionScene(parsed, file.name);
    } else if (format === "gravity-v0") {
      const validation = validateTakeLog(parsed);
      if (!validation.ok) throw new Error(validation.reason);
      takeLog = normalizeLoadedLog(parsed);
      loadedTakeFilename = file.name;
      loadedSceneSummary = "";
      elements.world.value = takeLog.worldId;
      elements.seed.value = String(takeLog.seed);
      const quantizeValue = takeLog.quantize.enabled
        ? ({ 1: "4", 2: "8", 4: "16" }[takeLog.quantize.division] ?? "off")
        : "off";
      elements.quantize.value = quantizeValue;
      state = "finished";
      rebuildLayout({ imported: true });
      elements.exportStatus.textContent = "";
    } else {
      throw new Error("対応していない形式です");
    }
  } catch (error) {
    elements.loadError.textContent = `読み込めませんでした（${error.message}）`;
  } finally {
    elements.takeFile.value = "";
  }
}

function keyName(code) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

function finishDiagnostic() {
  if (!diagnosticActive) return;
  diagnosticActive = false;
  const names = diagnosticKeys.maxKeys.map(keyName).join(" + ") || "なし";
  elements.diagnosticMessage.textContent = `同時に ${diagnosticKeys.max} キーまで届きました（最大 ${names}）`;
  elements.diagnosticNote.hidden = false;
}

function startDiagnostic() {
  if (diagnosticDisabledForState(state)) return;
  clearTimeout(diagnosticTimer);
  diagnosticKeys = pressTracker();
  diagnosticActive = true;
  elements.diagnosticPanel.hidden = false;
  elements.diagnosticNote.hidden = true;
  elements.diagnosticMessage.textContent = "3秒のあいだ、押せるだけ同時にキーを押してください";
  elements.diagnose.blur();
  document.body.focus({ preventScroll: true });
  diagnosticTimer = setTimeout(finishDiagnostic, PERFORMANCE.diagnosticDurationMs);
}

function closeDiagnostic() {
  clearTimeout(diagnosticTimer);
  diagnosticActive = false;
  elements.diagnosticPanel.hidden = true;
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
    exportButtons.forEach((button) => { button.disabled = state === "replay"; });
  }
}

elements.primary.addEventListener("click", () => {
  if (state === "idle") beginTake("START").catch(showError);
  else if (state === "finished") beginTake("RETAKE").catch(showError);
  else if (state === "replay") stopReplay().catch(showError);
  else stopTake().catch(showError);
});
elements.replay.addEventListener("click", () => beginReplay().catch(showError));
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
elements.scenePlay.addEventListener("click", loadBundledScene);
elements.takeFile.addEventListener("change", () => {
  const [file] = elements.takeFile.files;
  if (file) loadTakeFile(file);
});
elements.diagnose.addEventListener("click", startDiagnostic);
elements.diagnosticClose.addEventListener("click", closeDiagnostic);
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
    await downloadMixWav(audibleTakeLog(takeLog));
    elements.exportStatus.textContent = "WAVを書き出しました";
  });
});
elements.stems.addEventListener("click", () => {
  if (!takeLog) return;
  runExport(async () => {
    await downloadStems(audibleTakeLog(takeLog), ({ index, total }) => {
      elements.exportStatus.textContent = `ステム ${index}/${total} をレンダー中…`;
    });
    elements.exportStatus.textContent = "ステム3本を書き出しました";
  });
});
elements.midi.addEventListener("click", () => {
  if (!takeLog) return;
  runExport(async () => {
    elements.exportStatus.textContent = "MIDIを書き出し中…";
    downloadTakeMidi(audibleTakeLog(takeLog));
    elements.exportStatus.textContent = "MIDIを書き出しました";
  });
});
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", (event) => {
  if (diagnosticActive) diagnosticKeys.remove(event.code);
  else setKeyPressed(event.code, false);
});
window.addEventListener("resize", () => renderLayout());
narrowScreen.addEventListener("change", renderState);

const initial = parseParams(location.search);
elements.world.value = initial.world;
elements.seed.value = initial.seed || randomSeed();
rebuildLayout();
renderState();
updateDisplay();
