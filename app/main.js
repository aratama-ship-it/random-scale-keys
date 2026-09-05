import {
  accentForBeat,
  answerDegree,
  applyMelodySetting,
  automaticSfxForStep,
  approachDegree,
  chordDegreeNotes,
  chordMidiNotesFromRoot,
  chordRootInterval,
  chordRootMidiFromRoot,
  chordSeventhInterval,
  chordToneWeight,
  chooseChord,
  createLayout,
  decayTension,
  defaultTimbres,
  getScale,
  getWorld,
  harmonyScaleId,
  isResolution,
  KEY_LABELS,
  KEY_NAMES,
  KEY_ROWS,
  LEAD_TIMBRES,
  midiForDegreeFromRoot,
  noteMemory,
  noteLengthFromInterval,
  phraseRole,
  quantize,
  reverbSendFromSilence,
  resolveScaleId,
  roleForDegree,
  sectionForBar,
  SFX_KEYS,
  SFX_LABELS,
  sfxNoiseSeed,
  TIMBRE_LABELS,
  tonicChordForScale,
  updateTension,
  velocityFromInterval,
  voiceLead,
} from "../prototype/gravity.mjs";
import {
  RHYTHMS,
  bpmForRhythm,
  drumHitsForStep,
  drumSwingSeconds,
} from "../prototype/rhythms.mjs";
import { downloadTakeJson, scheduleRecordedTake } from "../prototype/render.js";
import { createSynth, HOLD_MAX_SECONDS } from "../prototype/synth.js";
import { downloadTakeMidi } from "./midi.js";
import { detectFormat, sceneToEvents } from "./scene-map.mjs";
import { downloadMixWav, downloadStems } from "./stems.js";
import {
  diagnosticDisabledForState,
  formatParams,
  holdRelease,
  nextTakeSettingsDisabledForState,
  parseParams,
  pressTracker,
  remainingSeconds,
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
const SFX_ROW = "1234567890";
const ROLE_MARKS = Object.freeze({ stable: "●", floating: "◐", tension: "▲" });
const EFFECT_LABELS = Object.freeze({ none: "—", delay: "dly", sweep: "swp", octave: "oct", stutter: "stt", arpeggio: "arp" });
const FORM_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

const elements = {
  answer: document.querySelector("#answer"),
  accompaniment: document.querySelector("#accompaniment"),
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
  key: document.querySelector("#key"),
  keyboard: document.querySelector("#keyboard"),
  melody: document.querySelector("#melody"),
  primary: document.querySelector("#primary-action"),
  performanceTip: document.querySelector("#performance-tip"),
  quantize: document.querySelector("#quantize"),
  reroll: document.querySelector("#reroll"),
  rhythm: document.querySelector("#rhythm"),
  retake: document.querySelector("#retake"),
  replay: document.querySelector("#replay"),
  seed: document.querySelector("#seed"),
  scenePlay: document.querySelector("#scene-play"),
  sceneSummary: document.querySelector("#scene-summary"),
  settings: document.querySelector("#settings"),
  shareLink: document.querySelector("#share-link"),
  statusLabel: document.querySelector("#status-label"),
  statusBpm: document.querySelector("#status-bpm"),
  statusKey: document.querySelector("#status-key"),
  statusPosition: document.querySelector("#status-position"),
  statusSection: document.querySelector("#status-section"),
  statusSeed: document.querySelector("#status-seed"),
  statusWorld: document.querySelector("#status-world"),
  takeSummary: document.querySelector("#take-summary"),
  takeFile: document.querySelector("#take-file"),
  loadError: document.querySelector("#load-error"),
  loadedTake: document.querySelector("#loaded-take"),
  tensionFill: document.querySelector("#tension-fill"),
  timbre: document.querySelector("#timbre"),
  timbreShift: document.querySelector("#timbre-shift"),
  stems: document.querySelector("#stems"),
  midi: document.querySelector("#midi"),
  progressFill: document.querySelector("#progress-fill"),
  progressTrack: document.querySelector("#progress-track"),
  remaining: document.querySelector("#status-remaining"),
  scale: document.querySelector("#scale"),
  scaleSummary: document.querySelector("#scale-summary"),
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
let lastPhysicalSfxPressTime = -Infinity;
let currentChord = "I";
let nextChord = "I";
let padVoices;
let chordHistory = [];
let pendingResolutionBeat = Infinity;
let resolutionReverbUntilBeat = -Infinity;
let lastPressEvent;
let previousMelodyNote;
let beforePreviousMelodyNote;
let answerCount = 0;
let takeLog;
let loadedTakeFilename = "";
let loadedSceneSummary = "";
let diagnosticActive = false;
let diagnosticKeys;
let diagnosticTimer;
const keyRects = new Map();
const activeHolds = new Map();

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

function selectedTimbres() {
  return { main: elements.timbre.value, shift: elements.timbreShift.value };
}

function selectedMelody() {
  return elements.melody.value === "off" ? "off" : "gravity";
}

function selectedRhythm() {
  return Object.hasOwn(RHYTHMS, elements.rhythm.value) ? elements.rhythm.value : "gravity";
}

function selectedAccompaniment() {
  return elements.accompaniment.value === "drums" ? "drums" : "full";
}

function selectedBpm() {
  const world = getWorld(layout?.worldId ?? elements.world.value);
  return bpmForRhythm(selectedRhythm(), world.bpm);
}

function selectedKeyChoice() {
  return elements.key.value === "random" ? "random" : Number(elements.key.value);
}

function populateTimbreSelects() {
  [elements.timbre, elements.timbreShift].forEach((select) => {
    select.replaceChildren(...LEAD_TIMBRES.map((timbre) => {
      const option = document.createElement("option");
      option.value = timbre;
      option.textContent = TIMBRE_LABELS[timbre];
      return option;
    }));
  });
}

function resetTimbresForWorld() {
  const timbres = defaultTimbres(elements.world.value);
  elements.timbre.value = timbres.main;
  elements.timbreShift.value = timbres.shift;
}

function resetKeyForWorld() {
  elements.key.value = String(getWorld(elements.world.value).rootMidi % 12);
}

function updateUrl() {
  history.replaceState(null, "", formatParams({
    world: elements.world.value,
    scale: elements.scale.value,
    seed: elements.seed.value,
    key: selectedKeyChoice(),
  }));
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
    KEY_ROWS.forEach((codes, rowIndex) => {
      const rowLeft = (window.innerWidth - widestWidth) / 2 + rowOffsetPx(rowIndex, keySize);
      const rowTop = top + rowIndex * (keySize + keyGap);
      codes.forEach((code, columnIndex) => {
        keyRects.set(code, {
          left: rowLeft + columnIndex * (keySize + keyGap),
          top: rowTop,
          width: keySize,
          height: keySize,
        });
      });
    });
  }

  const sources = [...keyRects].filter(([code]) => Object.hasOwn(layout.keys, code)).map(([code, rect]) => ({
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
  const sfxRow = document.createElement("div");
  sfxRow.className = "key-row";
  sfxRow.style.marginLeft = "0";
  for (const digit of SFX_ROW) {
    const code = `Digit${digit}`;
    const assignment = SFX_KEYS[code];
    const key = document.createElement("button");
    key.type = "button";
    key.className = "key key-sfx";
    key.dataset.code = code;
    key.setAttribute("aria-label", `${digit}、SFX ${assignment.type} ${assignment.variant}`);
    key.innerHTML = `<span class="key-degree">${digit}</span><span class="key-meta">${SFX_LABELS[assignment.type]}</span>`;
    key.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      playSfx(code, "pointer");
    });
    sfxRow.append(key);
  }
  elements.keyboard.append(sfxRow);
  KEY_ROWS.forEach((codes, rowIndex) => {
    const row = document.createElement("div");
    row.className = "key-row";
    row.style.marginLeft = `${rowOffsetPx(rowIndex, keySize)}px`;
    for (const code of codes) {
      const assignment = layout.keys[code];
      const key = document.createElement("button");
      key.type = "button";
      key.className = `key key-${assignment.role}`;
      key.dataset.code = code;
      key.setAttribute("aria-label", `${KEY_LABELS[code]}、度数${assignment.degree}、${assignment.role}、${assignment.effect}`);
      key.innerHTML = `<span class="key-degree">${assignment.degree}</span><span class="key-meta">${ROLE_MARKS[assignment.role]} ${EFFECT_LABELS[assignment.effect]}</span>`;
      key.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        playCode(code, "pointer", elements.timbre.value);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
        key.addEventListener(type, () => releaseHold(code, audioContext?.currentTime));
      });
      row.append(key);
    }
    elements.keyboard.append(row);
  });
  requestAnimationFrame(updateContourGeometry);
}

function rebuildLayout({ replaceUrl = true, imported = false } = {}) {
  layout = createLayout(normalizedSeed(), elements.world.value, elements.scale.value, selectedKeyChoice());
  elements.seed.value = String(layout.seed);
  elements.scale.value = layout.scaleId;
  document.documentElement.dataset.world = layout.worldId;
  document.body.dataset.imported = String(imported);
  currentChord = tonicChordForScale(layout.scaleId);
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
  elements.performanceTip.hidden = state !== "idle";
  document.body.dataset.state = state;
  for (const control of elements.settings.elements) control.disabled = state !== "idle";
  [elements.world, elements.key, elements.scale, elements.rhythm, elements.accompaniment, elements.melody, elements.quantize, elements.timbre, elements.timbreShift, elements.seed, elements.reroll]
    .forEach((control) => { control.disabled = nextTakeSettingsDisabledForState(state); });
  elements.diagnose.disabled = diagnosticDisabledForState(state);
  elements.primary.disabled = (state === "idle" || state === "finished") && narrowScreen.matches;
  elements.primary.textContent = active ? "停止 (Enter)" : finished ? "もう1テイク" : "演奏開始";
  elements.statusLabel.textContent = state === "idle" ? "待機" : state === "countin" ? "カウントイン" : state === "playing" ? "演奏中" : state === "replay" ? "再生中" : "テイク完了";
  elements.statusWorld.textContent = `世界 ${layout?.worldId ?? elements.world.value}`;
  elements.statusKey.textContent = `キー ${KEY_NAMES[layout?.key ?? Number(elements.key.value)]}`;
  elements.statusBpm.textContent = `♩=${state === "countin" || state === "playing" || state === "replay" ? takeLog?.bpm ?? selectedBpm() : selectedBpm()}`;
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
  elements.scaleSummary.textContent = `スケール: ${getScale(resolveScaleId(takeLog.worldId, takeLog.scaleId)).label}`;
  elements.loadedTake.hidden = !loadedTakeFilename;
  const loadedKind = loadedSceneSummary ? "シーン" : "テイク";
  elements.loadedTake.textContent = loadedTakeFilename ? `読み込んだ${loadedKind}: ${loadedTakeFilename}` : "";
  elements.sceneSummary.hidden = !loadedSceneSummary;
  elements.sceneSummary.textContent = loadedSceneSummary;
  elements.shareLink.textContent = `共有リンク: ${formatParams({ world: takeLog.worldId, scale: takeLog.scaleId, seed: takeLog.seed, key: selectedKeyChoice() })}（配置だけを共有。テイクはWAV/JSONで）`;
}

function showAnswer(degree) {
  clearTimeout(answerTimer);
  elements.answer.textContent = `応答: 度数${degree}`;
  terrain.answer();
  answerTimer = setTimeout(() => { elements.answer.textContent = ""; }, PERFORMANCE.answerVisibleMs);
}

function showBentDegree(degree) {
  clearTimeout(answerTimer);
  elements.answer.textContent = `→ ${degree}`;
  answerTimer = setTimeout(() => { elements.answer.textContent = ""; }, PERFORMANCE.answerVisibleMs);
}

function scheduleAnswerDisplay(degree, delayMs) {
  const timer = setTimeout(() => showAnswer(degree), Math.max(0, delayMs));
  scheduledAnswerTimers.push(timer);
}

function rootMidiForChord(rootMidi, scaleId, chordName) {
  return chordRootMidiFromRoot(rootMidi, scaleId, chordName, 2);
}

function voicingForChord(chordName, previousVoices, options) {
  const pitchClasses = chordMidiNotesFromRoot(layout.rootMidi, layout.scaleId, chordName).map((midi) => midi % 12);
  return voiceLead(previousVoices, pitchClasses, options);
}

function bassChordNotes(chordName) {
  const root = rootMidiForChord(layout.rootMidi, layout.scaleId, chordName);
  let previous = root - 1;
  return chordMidiNotesFromRoot(layout.rootMidi, layout.scaleId, chordName).map((midi) => {
    let candidate = midi % 12;
    while (candidate <= previous) candidate += 12;
    previous = candidate;
    return candidate;
  });
}

function nearestMidiForPitchClass(pitchClass, reference) {
  const center = pitchClass + Math.floor(reference / 12) * 12;
  return [center - 12, center, center + 12]
    .sort((left, right) => Math.abs(left - reference) - Math.abs(right - reference) || left - right)[0];
}

function repeatedChordCount(chordName) {
  let count = 0;
  for (let index = chordHistory.length - 1; index >= 0 && chordHistory[index] === chordName; index -= 1) count += 1;
  return count;
}

function chooseNextChord(barIndex, decisionBeat, currentTension) {
  const targetBar = barIndex + 1;
  const resolution = takeLog.events.some((event) => (
    event.kind === "press"
    && event.resolution === true
    && event.beat >= barIndex * PERFORMANCE.beatsPerBar
    && event.beat <= decisionBeat
  ));
  return chooseChord({
    scaleId: layout.scaleId,
    section: sectionForBar(targetBar),
    sectionBar: targetBar % PERFORMANCE.beatsPerBar,
    tension: currentTension,
    memory: noteMemory(takeLog.events, decisionBeat),
    previousChord: currentChord,
    repeatCount: repeatedChordCount(currentChord),
    previousVoices: padVoices,
    tonicPitchClass: layout.rootMidi % 12,
    resolution,
  });
}

function scheduleAnswerAtBoundary(beat, when, section) {
  if (beat === 0 || beat % 8 !== 0 || answerCount >= 8 || !lastPressEvent) return;
  if (lastPressEvent.beat < beat - 1 || lastPressEvent.beat >= beat || lastPressEvent.role === "stable") return;
  const degree = beat % 16 === 0 && beat > 0
    ? 1
    : answerDegree(layout.scaleId, lastPressEvent.degree, currentChord);
  const event = {
    time: when - takeStart,
    beat,
    kind: "answer",
    code: null,
    midi: midiForDegreeFromRoot(layout.rootMidi, layout.scaleId, degree, 0),
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
    timbre: elements.timbre.value,
  };
  synth.scheduleLead(event, when, event.length, event.velocity, "none", tension, {
    cutoffMinimum: section === "b" ? 1800 : 1200,
    timbre: event.timbre,
  });
  takeLog.events.push(event);
  answerCount += 1;
  scheduleAnswerDisplay(degree, (when - audioContext.currentTime) * 1000);
}

function scheduleAccompanimentStep(step) {
  const beat = step / PERFORMANCE.stepsPerBeat;
  const barIndex = Math.floor(step / (PERFORMANCE.stepsPerBeat * PERFORMANCE.beatsPerBar));
  const stepInBar = step % (PERFORMANCE.stepsPerBeat * PERFORMANCE.beatsPerBar);
  const section = sectionForBar(barIndex);
  const when = takeStart + beat * synth.beatSec;
  const drumsOnly = takeLog.accompaniment === "drums";

  if (section === "end") {
    tension = decayTension(tension, beat - lastTensionBeat);
    lastTensionBeat = beat;
    currentChord = tonicChordForScale(layout.scaleId);
    scheduleAnswerAtBoundary(beat, when, section);
    return;
  }

  const role = phraseRole(section, barIndex % PERFORMANCE.beatsPerBar);
  const arrival = barIndex > 0 && role === "arrival";
  const resolving = beat >= pendingResolutionBeat;
  if (stepInBar === 0) {
    tension = decayTension(tension, beat - lastTensionBeat);
    lastTensionBeat = beat;
    currentChord = resolving || barIndex === 0 ? tonicChordForScale(layout.scaleId) : nextChord;
    padVoices = voicingForChord(currentChord, padVoices, { rootPosition: arrival });
    chordHistory.push(currentChord);
    if (!drumsOnly) synth.schedulePad(currentChord, when, synth.beatSec * PERFORMANCE.beatsPerBar, tension, { voices: padVoices });
  }

  scheduleAnswerAtBoundary(beat, when, section);
  const currentTension = decayTension(tension, beat - lastTensionBeat);
  const silenceBeats = beat - lastPressBeat;
  if (beat >= resolutionReverbUntilBeat) synth.setReverbSend(reverbSendFromSilence(silenceBeats), when);

  if (resolving) {
    currentChord = tonicChordForScale(layout.scaleId);
    padVoices = voicingForChord(currentChord, padVoices, { rootPosition: arrival });
    if (!drumsOnly) {
      if (stepInBar !== 0) synth.schedulePad(currentChord, when, synth.beatSec * (PERFORMANCE.beatsPerBar - (beat % PERFORMANCE.beatsPerBar)), tension, { voices: padVoices });
      synth.scheduleResolution(layout.rootMidi, when);
    }
    pendingResolutionBeat = Infinity;
    resolutionReverbUntilBeat = beat + 2;
    scheduleVisualAt(when, () => {
      terrain.bloom();
      elements.chord.classList.add("resolution");
      setTimeout(() => elements.chord.classList.remove("resolution"), synth?.beatSec * 1000 || 0);
    });
  }

  automaticSfxForStep(barIndex, stepInBar, currentTension).forEach(({ type, variant, velocity }) => {
    synth.scheduleSfx(type, variant, when, velocity, {
      noiseSeed: sfxNoiseSeed(takeLog.seed, beat),
      stemRole: "accomp",
    });
  });
  const drumHits = drumHitsForStep(takeLog.rhythm, section, stepInBar, currentTension);
  const drumWhen = when + drumSwingSeconds(takeLog.rhythm, layout.worldId, stepInBar, synth.beatSec);
  drumHits.filter(({ type }) => type === "kick")
    .forEach(({ velocity }) => synth.scheduleKick(drumWhen, velocity));
  const bassNotes = bassChordNotes(currentChord);
  const fifth = bassNotes.find((midi) => (midi - bassNotes[0]) % 12 === 7) ?? bassNotes[1];
  const thirdBeatBass = currentTension >= 0.3 ? bassNotes[0] + 12 : fifth;
  if (!drumsOnly && stepInBar === 0) {
    synth.scheduleBass(bassNotes[0], when, 0.28, arrival ? 1 : 0.9);
  } else if (!drumsOnly && stepInBar === 8) {
    synth.scheduleBass(thirdBeatBass, when, 0.28, 0.75);
    if (section === "b") {
      synth.schedulePad(currentChord, when, synth.beatSec * 2, tension, { voices: padVoices, gainScale: 0.6 });
    }
  } else if (!drumsOnly && stepInBar === 12 && role === "cadence") {
    const seventhPitchClass = (layout.rootMidi + chordSeventhInterval(layout.scaleId, currentChord)) % 12;
    synth.scheduleBass(nearestMidiForPitchClass(seventhPitchClass, thirdBeatBass), when, 0.28, 0.7);
  } else if (stepInBar === 14) {
    if (barIndex + 1 < PERFORMANCE.bars) nextChord = chooseNextChord(barIndex, beat, currentTension);
    else nextChord = tonicChordForScale(layout.scaleId);
    if (!drumsOnly) {
      const nextRootSemitone = chordRootInterval(layout.scaleId, nextChord);
      const approach = approachDegree(nextRootSemitone, getScale(harmonyScaleId(layout.scaleId)));
      const approachPitchClass = (layout.rootMidi + approach) % 12;
      synth.scheduleBass(nearestMidiForPitchClass(approachPitchClass, thirdBeatBass), when, 0.28, 0.7);
    }
  }
  drumHits.filter(({ type }) => type === "snare")
    .forEach(({ velocity }) => synth.scheduleSnare(drumWhen, velocity));
  if (role === "cadence" && stepInBar === 14) synth.scheduleSnare(when, 0.7);
  let hatHits = drumHits.filter(({ type }) => type === "hatClosed" || type === "hatOpen");
  if ((section === "a" || section === "b") && arrival && stepInBar === 0) {
    hatHits = [{ type: "hatOpen", velocity: 1 }];
  }
  if (takeLog.rhythm !== "gravity" || silenceBeats < 8) {
    hatHits.forEach(({ type, velocity }) => synth.scheduleHat(drumWhen, type === "hatOpen", velocity));
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
    const isChordDecision = nextStep % (PERFORMANCE.stepsPerBeat * PERFORMANCE.beatsPerBar) === 14;
    if (isChordDecision && stepTime > audioContext.currentTime) break;
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
  const rhythm = selectedRhythm();
  const bpm = bpmForRhythm(rhythm, world.bpm);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザはWeb Audio APIに対応していません");
  audioContext = new AudioContextClass();
  await audioContext.resume();
  synth = createSynth(audioContext, {
    worldId: layout.worldId,
    scaleId: layout.scaleId,
    bpm,
    seed: layout.seed,
    rootMidi: layout.rootMidi,
  });
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
  lastPhysicalSfxPressTime = -Infinity;
  lastPressEvent = undefined;
  previousMelodyNote = undefined;
  beforePreviousMelodyNote = undefined;
  answerCount = 0;
  currentChord = tonicChordForScale(layout.scaleId);
  nextChord = currentChord;
  padVoices = undefined;
  chordHistory = [];
  pendingResolutionBeat = Infinity;
  resolutionReverbUntilBeat = -Infinity;
  nextStep = 0;
  takeLog = {
    version: "gravity-v0",
    engine: "accomp-v5",
    worldId: layout.worldId,
    scaleId: layout.scaleId,
    seed: layout.seed,
    rootMidi: layout.rootMidi,
    key: layout.key,
    bpm,
    bars: PERFORMANCE.bars,
    melody: selectedMelody(),
    rhythm,
    accompaniment: selectedAccompaniment(),
    quantize: selectedQuantize(),
    timbres: selectedTimbres(),
    events: [],
  };
  terrain.setTension(0);
  renderState();
  schedulerTimer = setInterval(scheduleAhead, PERFORMANCE.schedulerIntervalMs);
  scheduleAhead();
  if (takeLog.accompaniment === "drums") synth.scheduleEnding(takeEnd, { drumsOnly: true });
  else synth.scheduleEnding(takeEnd);
  finishTimer = setTimeout(markTakeFinished, Math.max(0, (takeEnd - audioContext.currentTime) * 1000));
}

function markTakeFinished() {
  releaseAllHolds(Math.min(audioContext?.currentTime ?? takeEnd, takeEnd));
  clearInterval(schedulerTimer);
  schedulerTimer = undefined;
  dispatch("TAKE_COMPLETE");
  terrain.end();
  tailTimer = setTimeout(() => closeAudio().catch(showError), PERFORMANCE.audioTailSeconds * 1000);
}

async function stopTake() {
  if (state !== "countin" && state !== "playing") return;
  releaseAllHolds(Math.min(audioContext?.currentTime ?? takeEnd, takeEnd));
  await closeAudio();
  dispatch("STOP");
  terrain.end();
}

function codeForReplayEvent(event) {
  if (event.kind === "sfx" && event.code && SFX_KEYS[event.code]) return event.code;
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
      if (event.kind === "sfx") {
        const code = codeForReplayEvent(event);
        const rect = code ? keyRects.get(code) : undefined;
        if (rect) terrain.press(rect, "sfx");
        if (code) {
          setKeyPressed(code, true);
          setTimeout(() => setKeyPressed(code, false), cssDurationMs("--duration-press"));
        }
        return;
      }
      if (event.kind !== "press") return;
      if (event.bent) showBentDegree(event.degree);
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
  synth = createSynth(audioContext, {
    worldId: takeLog.worldId,
    scaleId: takeLog.scaleId,
    bpm: takeLog.bpm,
    seed: takeLog.seed,
    rootMidi: takeLog.rootMidi ?? getWorld(takeLog.worldId).rootMidi,
  });
  state = transition(state, "REPLAY");
  takeStart = audioContext.currentTime + PERFORMANCE.audioLeadSeconds;
  takeEnd = takeStart + takeLog.bars * PERFORMANCE.beatsPerBar * synth.beatSec;
  tension = 0;
  lastTensionBeat = 0;
  currentChord = tonicChordForScale(resolveScaleId(takeLog.worldId, takeLog.scaleId));
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

function playCode(code, sourceId = "keyboard", timbre = elements.timbre.value) {
  if (state !== "playing" || !audioContext || !layout?.keys[code]) return;
  if (audioContext.currentTime < takeStart || audioContext.currentTime >= takeEnd) return;
  if (activeHolds.has(code)) return;
  const assignment = layout.keys[code];
  const played = applyMelodySetting(takeLog.melody, {
    previous: previousMelodyNote ?? null,
    beforePrevious: beforePreviousMelodyNote ?? null,
  }, {
    degree: assignment.degree,
    octave: assignment.octave,
    midi: assignment.midi,
  }, layout.scaleId);
  const playedRole = roleForDegree(layout.scaleId, played.degree);
  const playedAssignment = {
    ...assignment,
    degree: played.degree,
    octave: played.octave,
    midi: played.midi,
    role: playedRole,
  };
  const now = audioContext.currentTime;
  const scheduledTime = takeLog.quantize.enabled
    ? quantize(now, takeStart, synth.bpm, takeLog.quantize.division, 0.03)
    : now;
  const beat = (scheduledTime - takeStart) / synth.beatSec;
  const interval = now - lastPhysicalPressTime;
  const silenceBeforePress = beat - lastPressBeat;
  const section = sectionForBar(Math.floor(beat / PERFORMANCE.beatsPerBar));
  const accent = accentForBeat(beat % PERFORMANCE.beatsPerBar);
  const chordWeight = chordToneWeight(chordDegreeNotes(layout.scaleId, currentChord), played.degree);
  const returnGain = silenceBeforePress >= 4 ? 1.2 : 1;
  const returnLength = silenceBeforePress >= 4 ? 1.5 : 1;
  const velocity = velocityFromInterval(interval) * accent.gain * chordWeight.gain * returnGain;
  const length = noteLengthFromInterval(interval) * accent.length * chordWeight.length * returnLength;
  const deltaBeats = Math.max(0, beat - lastTensionBeat);
  const previousTension = decayTension(tension, deltaBeats);
  const nextTension = updateTension(tension, deltaBeats, playedRole, layout.scaleId);
  const resolution = isResolution(previousTension, nextTension, playedRole);

  tension = nextTension;
  lastTensionBeat = beat;
  lastPressBeat = beat;
  lastPhysicalPressTime = now;
  if (resolution) pendingResolutionBeat = Math.floor(beat) + 1;
  synth.setReverbSend(0.2, scheduledTime, synth.beatSec * 0.5);
  const loggedEvent = {
    time: scheduledTime - takeStart,
    beat,
    kind: "press",
    code,
    midi: played.midi,
    degree: played.degree,
    role: playedRole,
    effect: assignment.effect,
    keyDegree: assignment.degree,
    keyMidi: assignment.midi,
    ...(played.bent ? { bent: true, rule: played.rule } : {}),
    velocity,
    length,
    tBefore: previousTension,
    tAfter: nextTension,
    resolution,
    sourceId,
    section,
    timbre,
  };
  const handle = synth.scheduleLead(playedAssignment, scheduledTime, length, velocity, assignment.effect, nextTension, {
    cutoffMinimum: section === "b" ? 1800 : 1200,
    timbre,
    hold: "open",
  });
  takeLog.events.push(loggedEvent);
  beforePreviousMelodyNote = previousMelodyNote;
  previousMelodyNote = { degree: played.degree, midi: played.midi };
  if (handle) activeHolds.set(code, { handle, when: scheduledTime, length, event: loggedEvent });
  lastPressEvent = loggedEvent;
  const key = elements.keyboard.querySelector(`[data-code="${code}"]`);
  if (key) terrain.press(key.getBoundingClientRect(), playedRole);
  if (played.bent) showBentDegree(played.degree);
  setKeyPressed(code, true);
  setTimeout(() => setKeyPressed(code, false), cssDurationMs("--duration-press"));
}

function releaseHold(code, nowSec) {
  const active = activeHolds.get(code);
  if (!active || !Number.isFinite(nowSec)) return;
  const result = holdRelease(active.when, active.length, nowSec, HOLD_MAX_SECONDS);
  active.handle.release(result.releaseAt);
  active.event.length = result.length;
  if (result.held) active.event.held = true;
  activeHolds.delete(code);
}

function releaseAllHolds(releaseAt) {
  if (!Number.isFinite(releaseAt)) return;
  activeHolds.forEach((active, code) => {
    const cappedReleaseAt = Math.min(releaseAt, active.when + HOLD_MAX_SECONDS);
    active.handle.release(cappedReleaseAt);
    active.event.length = Math.max(0, cappedReleaseAt - active.when);
    if (active.event.length > active.length + 1e-6) active.event.held = true;
    activeHolds.delete(code);
  });
}

function playSfx(code, sourceId = "keyboard") {
  const assignment = SFX_KEYS[code];
  if (state !== "playing" || !audioContext || !assignment) return;
  if (audioContext.currentTime < takeStart || audioContext.currentTime >= takeEnd) return;
  const now = audioContext.currentTime;
  const scheduledTime = takeLog.quantize.enabled
    ? quantize(now, takeStart, synth.bpm, takeLog.quantize.division, 0.03)
    : now;
  const beat = (scheduledTime - takeStart) / synth.beatSec;
  const velocity = velocityFromInterval(now - lastPhysicalSfxPressTime);
  const section = sectionForBar(Math.floor(beat / PERFORMANCE.beatsPerBar));
  lastPhysicalSfxPressTime = now;
  synth.scheduleSfx(assignment.type, assignment.variant, scheduledTime, velocity, {
    noiseSeed: sfxNoiseSeed(takeLog.seed, beat),
    stemRole: "lead",
  });
  takeLog.events.push({
    time: scheduledTime - takeStart,
    beat,
    kind: "sfx",
    code,
    sfx: assignment.type,
    variant: assignment.variant,
    velocity,
    section,
    sourceId,
  });
  const key = elements.keyboard.querySelector(`[data-code="${code}"]`);
  if (key) terrain.press(key.getBoundingClientRect(), "sfx");
  setKeyPressed(code, true);
  setTimeout(() => setKeyPressed(code, false), cssDurationMs("--duration-press"));
}

function handleKeyDown(event) {
  if (diagnosticActive) {
    if (!event.repeat && event.code) diagnosticKeys.add(event.code);
    event.preventDefault();
    return;
  }
  if (event.key === "Shift") {
    elements.keyboard.classList.add("shift");
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
  if (event.repeat) return;
  if (SFX_KEYS[event.code] && state === "playing") {
    event.preventDefault();
    playSfx(event.code);
    return;
  }
  if (!layout?.keys[event.code]) return;
  if (state === "playing") {
    event.preventDefault();
    playCode(event.code, "keyboard", event.shiftKey ? elements.timbreShift.value : elements.timbre.value);
  }
}

function handleKeyUp(event) {
  if (diagnosticActive) {
    diagnosticKeys.remove(event.code);
    return;
  }
  if (event.key === "Shift") elements.keyboard.classList.remove("shift");
  releaseHold(event.code, audioContext?.currentTime);
  setKeyPressed(event.code, false);
}

function updateDisplay() {
  if (audioContext && synth && (state === "countin" || state === "playing" || state === "replay")) {
    const now = audioContext.currentTime;
    if (state === "countin") {
      const beatsLeft = Math.ceil((takeStart - now) / synth.beatSec);
      elements.countin.textContent = beatsLeft > 0 ? String(Math.min(PERFORMANCE.beatsPerBar, beatsLeft)) : "";
      elements.remaining.textContent = " ／ まもなく開始";
      elements.progressFill.style.width = "0%";
      elements.progressTrack.setAttribute("aria-valuenow", "0");
      if (now >= takeStart) dispatch("COUNTIN_COMPLETE");
    } else {
      elements.countin.textContent = "";
      const seconds = remainingSeconds(now, takeStart, takeEnd);
      const progress = Math.max(0, Math.min(1, (now - takeStart) / (takeEnd - takeStart)));
      elements.remaining.textContent = seconds > 0 ? ` ／ 残り ${seconds}秒` : "";
      elements.progressFill.style.width = `${progress * 100}%`;
      elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
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
    elements.remaining.textContent = "";
    elements.progressFill.style.width = "0%";
    elements.progressTrack.setAttribute("aria-valuenow", "0");
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
  const defaults = defaultTimbres(log.worldId);
  const rootMidi = log.rootMidi ?? getWorld(log.worldId).rootMidi;
  const timbres = {
    main: typeof log.timbres?.main === "string" ? log.timbres.main : defaults.main,
    shift: typeof log.timbres?.shift === "string" ? log.timbres.shift : defaults.shift,
  };
  return {
    ...log,
    engine: "accomp-v5",
    melody: log.melody === "off" ? "off" : "gravity",
    rhythm: Object.hasOwn(RHYTHMS, log.rhythm) ? log.rhythm : "gravity",
    accompaniment: log.accompaniment === "drums" ? "drums" : "full",
    scaleId: resolveScaleId(log.worldId, log.scaleId),
    rootMidi,
    key: log.key ?? rootMidi % 12,
    timbres,
    events: log.events.map((event) => {
      const section = typeof event.section === "string"
        ? event.section
        : sectionForBar(Math.floor(event.beat / PERFORMANCE.beatsPerBar));
      if (event.kind === "sfx") {
        return {
          ...event,
          sourceId: typeof event.sourceId === "string" ? event.sourceId : "keyboard",
          section,
        };
      }
      return {
        ...event,
        effect: typeof event.effect === "string" ? event.effect : "none",
        tBefore: Number.isFinite(event.tBefore) ? event.tBefore : 0,
        tAfter: Number.isFinite(event.tAfter) ? event.tAfter : 0,
        resolution: event.resolution === true,
        sourceId: typeof event.sourceId === "string" ? event.sourceId : "gravity",
        section,
      };
    }),
  };
}

function audibleTakeLog(log) {
  return {
    ...log,
    events: log.events.filter((event) => event.kind === "press" || event.kind === "answer" || event.kind === "sfx"),
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
  const rhythm = selectedRhythm();
  const bpm = bpmForRhythm(rhythm, world.bpm);
  const seed = normalizedSeed();
  elements.seed.value = String(seed);
  takeLog = sceneToEvents(scene, {
    worldId: world.id,
    scaleId: elements.scale.value,
    seed,
    bpm,
    bars: PERFORMANCE.bars,
    keyChoice: selectedKeyChoice(),
    melody: selectedMelody(),
    rhythm,
    accompaniment: selectedAccompaniment(),
    quantize: selectedQuantize(),
  });
  takeLog.timbres = selectedTimbres();
  takeLog.events = takeLog.events.map((event) => (
    event.kind === "press" ? { ...event, timbre: takeLog.timbres.main } : event
  ));
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
      elements.scale.value = takeLog.scaleId;
      elements.key.value = String(takeLog.key);
      elements.timbre.value = takeLog.timbres.main;
      elements.timbreShift.value = takeLog.timbres.shift;
      elements.melody.value = takeLog.melody === "off" ? "off" : "on";
      elements.rhythm.value = takeLog.rhythm;
      elements.accompaniment.value = takeLog.accompaniment;
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
elements.world.addEventListener("change", () => {
  resetTimbresForWorld();
  resetKeyForWorld();
  rebuildLayout();
});
elements.scale.addEventListener("change", () => rebuildLayout());
elements.key.addEventListener("change", () => rebuildLayout());
elements.rhythm.addEventListener("change", renderState);
elements.accompaniment.addEventListener("change", renderState);
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
window.addEventListener("keyup", handleKeyUp);
// ウィンドウからフォーカスが外れると keyup が届かず、押しっぱなしの音が上限（16秒）まで残る。
// 離脱時に保持中の音をすべて解放する（2026-09-04 サステイン残りの再発防止）
window.addEventListener("blur", () => releaseAllHolds(audioContext?.currentTime));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseAllHolds(audioContext?.currentTime);
});
window.addEventListener("resize", () => renderLayout());
narrowScreen.addEventListener("change", renderState);

const initial = parseParams(location.search);
populateTimbreSelects();
elements.world.value = initial.world;
elements.scale.value = initial.scale;
resetTimbresForWorld();
if (initial.key === undefined) resetKeyForWorld();
else elements.key.value = String(initial.key);
elements.seed.value = initial.seed || randomSeed();
rebuildLayout();
renderState();
updateDisplay();
