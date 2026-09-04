import { audioBufferToWav, downloadBlob, renderTakeToWav, scheduleRecordedTake } from "../prototype/render.js";
import { createSynth } from "../prototype/synth.js";

const STEMS = Object.freeze(["lead", "accomp", "fx"]);
const SAMPLE_RATE = 44100;
const AUDIO_TAIL_SECONDS = 4;

function safeFilenamePart(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-");
}

export function exportTimestamp(date = new Date()) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}`;
}

export function wavFilename(log, kind, date = new Date()) {
  if (![...STEMS, "mix"].includes(kind)) throw new TypeError(`Unknown WAV kind: ${kind}`);
  return `rsk_${safeFilenamePart(log.worldId)}_${safeFilenamePart(log.seed)}_${exportTimestamp(date)}_${kind}.wav`;
}

function scheduleOfflineTake(context, synth, log) {
  const beatSec = 60 / log.bpm;
  const barsAtSuspendFrame = new Map();

  scheduleRecordedTake(context, synth, log, 0, 0, 4);
  for (let bar = 1; bar <= log.bars; bar += 1) {
    const suspendTime = bar * 4 * beatSec - 0.1;
    const suspendFrame = Math.ceil((suspendTime * SAMPLE_RATE) / 128) * 128;
    const bars = barsAtSuspendFrame.get(suspendFrame) ?? [];
    bars.push(bar);
    barsAtSuspendFrame.set(suspendFrame, bars);
  }

  return [...barsAtSuspendFrame].map(async ([suspendFrame, bars]) => {
    await context.suspend(suspendFrame / SAMPLE_RATE);
    try {
      bars.forEach((bar) => {
        const toBeat = bar < log.bars ? (bar + 1) * 4 : Infinity;
        scheduleRecordedTake(context, synth, log, 0, bar * 4, toBeat);
      });
    } finally {
      await context.resume();
    }
  });
}

export async function renderStemToWav(log, stem) {
  if (!STEMS.includes(stem)) throw new TypeError(`Unknown stem: ${stem}`);
  const duration = log.bars * 4 * (60 / log.bpm) + AUDIO_TAIL_SECONDS;
  const context = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const synth = createSynth(context, {
    worldId: log.worldId,
    scaleId: log.scaleId,
    bpm: log.bpm,
    seed: log.seed,
    stem,
  });
  const suspensionTasks = scheduleOfflineTake(context, synth, log);
  const rendering = context.startRendering();
  await Promise.all(suspensionTasks);
  return audioBufferToWav(await rendering);
}

export async function downloadMixWav(log, date = new Date()) {
  const wav = await renderTakeToWav(log);
  downloadBlob(new Blob([wav], { type: "audio/wav" }), wavFilename(log, "mix", date));
}

export async function downloadStems(log, onProgress = () => {}, date = new Date()) {
  for (let index = 0; index < STEMS.length; index += 1) {
    const stem = STEMS[index];
    onProgress({ index: index + 1, total: STEMS.length, stem });
    const wav = await renderStemToWav(log, stem);
    downloadBlob(new Blob([wav], { type: "audio/wav" }), wavFilename(log, stem, date));
  }
}
