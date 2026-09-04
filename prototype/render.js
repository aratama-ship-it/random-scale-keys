import {
  approachDegree,
  chordMidiNotes,
  chordRootInterval,
  chordRootMidi,
  chordSeventhInterval,
  chooseChord,
  decayTension,
  getScale,
  getWorld,
  harmonyScaleId,
  hatForStep,
  hatSwingSeconds,
  kickForStep,
  noteMemory,
  phraseRole,
  reverbSendFromSilence,
  resolveScaleId,
  sectionForBar,
  snareForStep,
  tonicChordForScale,
  voiceLead,
} from "./gravity.mjs";
import { createSynth } from "./synth.js";

function rootMidiForChord(worldId, scaleId, chordName) {
  return chordRootMidi(worldId, scaleId, chordName, 2);
}

function tensionAtBeat(events, beat) {
  const latest = events
    .filter((event) => event.kind === "press" && event.beat <= beat && Number.isFinite(event.tAfter))
    .at(-1);
  return latest ? decayTension(latest.tAfter, beat - latest.beat) : 0;
}

function repeatedTail(entries, chordName) {
  let count = 0;
  for (let index = entries.length - 1; index >= 0 && entries[index].chordName === chordName; index -= 1) count += 1;
  return count;
}

function voicingForChord(worldId, scaleId, chordName, previousVoices, options) {
  const pitchClasses = chordMidiNotes(worldId, scaleId, chordName)
    .map((midi) => midi % 12);
  return voiceLead(previousVoices, pitchClasses, options);
}

export function accompanimentPlan(log) {
  const world = getWorld(log.worldId);
  const scaleId = resolveScaleId(log.worldId, log.scaleId);
  const events = [...log.events].sort((left, right) => left.beat - right.beat);
  const tonic = tonicChordForScale(scaleId);
  const entries = [{
    barIndex: 0,
    decisionBeat: null,
    chordName: tonic,
    voices: voicingForChord(log.worldId, scaleId, tonic),
  }];
  for (let barIndex = 1; barIndex < log.bars; barIndex += 1) {
    const decisionBeat = barIndex * 4 - 0.5;
    const previous = entries.at(-1);
    const resolution = events.some((event) => (
      event.kind === "press"
      && event.resolution === true
      && event.beat >= (barIndex - 1) * 4
      && event.beat <= decisionBeat
    ));
    const chordName = chooseChord({
      scaleId,
      section: sectionForBar(barIndex),
      sectionBar: barIndex % 4,
      tension: tensionAtBeat(events, decisionBeat),
      memory: noteMemory(events, decisionBeat),
      previousChord: previous.chordName,
      repeatCount: repeatedTail(entries, previous.chordName),
      previousVoices: previous.voices,
      tonicPitchClass: world.rootMidi % 12,
      resolution,
    });
    const arrival = phraseRole(sectionForBar(barIndex), barIndex % 4) === "arrival";
    entries.push({
      barIndex,
      decisionBeat,
      chordName,
      voices: voicingForChord(log.worldId, scaleId, chordName, previous.voices, { rootPosition: arrival }),
    });
  }
  return entries;
}

function bassChordNotes(worldId, scaleId, chordName) {
  const root = rootMidiForChord(worldId, scaleId, chordName);
  let previous = root - 1;
  return chordMidiNotes(worldId, scaleId, chordName).map((midi) => {
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

export function partitionEventsByBar(events, bars, beatsPerBar = 4) {
  const partitions = Array.from({ length: bars + 1 }, () => []);
  events.forEach((event) => {
    const barIndex = Math.min(bars, Math.floor(event.beat / beatsPerBar));
    partitions[barIndex].push(event);
  });
  return partitions;
}

export function scheduleRecordedTake(context, synth, log, startTime = 0, fromBeat = 0, toBeat = Infinity) {
  const world = getWorld(log.worldId);
  const scaleId = resolveScaleId(log.worldId, log.scaleId);
  const bpm = log.bpm;
  const beatSec = 60 / bpm;
  const bars = log.bars;
  const events = [...log.events].sort((left, right) => left.beat - right.beat);
  const chordPlan = accompanimentPlan(log);
  const includesBeat = (beat) => beat >= fromBeat && beat < toBeat;
  let eventIndex = 0;
  let tension = 0;
  let lastTensionBeat = 0;
  let lastPressBeat = 0;
  let chordName = tonicChordForScale(scaleId);
  let padVoices = chordPlan[0].voices;
  let pendingResolutionBeat = Infinity;
  let resolutionReverbUntilBeat = -Infinity;

  partitionEventsByBar(events, bars).flat().filter((event) => (
    includesBeat(event.beat) && ["press", "answer"].includes(event.kind ?? "press")
  )).forEach((event) => {
    synth.scheduleLead(
      event,
      startTime + event.time,
      event.length,
      event.velocity,
      event.effect,
      event.tAfter,
      { cutoffMinimum: event.section === "b" ? 1800 : 1200 },
    );
  });

  for (let step = 0; step < bars * 16; step += 1) {
    const beat = step / 4;
    const barIndex = Math.floor(step / 16);
    const stepInBar = step % 16;
    const section = sectionForBar(barIndex);
    const role = phraseRole(section, barIndex % 4);
    const arrival = barIndex > 0 && role === "arrival";
    const schedulesStep = includesBeat(beat);

    while (eventIndex < events.length && events[eventIndex].beat <= beat + 1e-9) {
      const event = events[eventIndex];
      if (event.kind === "press") {
        tension = event.tAfter;
        lastTensionBeat = event.beat;
        lastPressBeat = event.beat;
        if (event.resolution) pendingResolutionBeat = Math.floor(event.beat) + 1;
      }
      eventIndex += 1;
    }

    const resolving = beat >= pendingResolutionBeat;
    if (stepInBar === 0) {
      tension = decayTension(tension, beat - lastTensionBeat);
      lastTensionBeat = beat;
      chordName = resolving ? tonicChordForScale(scaleId) : chordPlan[barIndex].chordName;
      padVoices = resolving
        ? voicingForChord(log.worldId, scaleId, chordName, padVoices, { rootPosition: arrival })
        : chordPlan[barIndex].voices;
      if (schedulesStep) {
        synth.schedulePad(chordName, startTime + beat * beatSec, beatSec * 4, tension, {
          voices: padVoices,
        });
      }
    }

    const currentTension = decayTension(tension, beat - lastTensionBeat);
    const silenceBeats = beat - lastPressBeat;
    const when = startTime + beat * beatSec;
    if (schedulesStep && beat >= resolutionReverbUntilBeat) {
      synth.setReverbSend(reverbSendFromSilence(silenceBeats), when);
    }

    if (resolving) {
      chordName = tonicChordForScale(scaleId);
      padVoices = voicingForChord(log.worldId, scaleId, chordName, padVoices, { rootPosition: arrival });
      if (schedulesStep) {
        if (stepInBar !== 0) synth.schedulePad(chordName, when, beatSec * (4 - (beat % 4)), tension, { voices: padVoices });
        synth.scheduleResolution(world.rootMidi, when);
      }
      pendingResolutionBeat = Infinity;
      resolutionReverbUntilBeat = beat + 2;
    }

    if (!schedulesStep) continue;
    if (kickForStep(section, stepInBar)) synth.scheduleKick(when);
    const bassNotes = bassChordNotes(log.worldId, scaleId, chordName);
    const fifth = bassNotes.find((midi) => (midi - bassNotes[0]) % 12 === 7) ?? bassNotes[1];
    const thirdBeatBass = currentTension >= 0.3 ? bassNotes[0] + 12 : fifth;
    if (stepInBar === 0) {
      synth.scheduleBass(bassNotes[0], when, 0.28, arrival ? 1 : 0.9);
    } else if (stepInBar === 8) {
      synth.scheduleBass(thirdBeatBass, when, 0.28, 0.75);
      if (section === "b") {
        synth.schedulePad(chordName, when, beatSec * 2, tension, { voices: padVoices, gainScale: 0.6 });
      }
    } else if (stepInBar === 12 && role === "cadence") {
      const seventhPitchClass = (world.rootMidi + chordSeventhInterval(scaleId, chordName)) % 12;
      synth.scheduleBass(nearestMidiForPitchClass(seventhPitchClass, thirdBeatBass), when, 0.28, 0.7);
    } else if (stepInBar === 14) {
      const nextChord = chordPlan[barIndex + 1]?.chordName ?? tonicChordForScale(scaleId);
      const nextRootSemitone = chordRootInterval(scaleId, nextChord);
      const approach = approachDegree(nextRootSemitone, getScale(harmonyScaleId(scaleId)));
      const approachPitchClass = (world.rootMidi + approach) % 12;
      synth.scheduleBass(nearestMidiForPitchClass(approachPitchClass, thirdBeatBass), when, 0.28, 0.7);
    }
    if (snareForStep(section, stepInBar)) {
      synth.scheduleSnare(when);
    }
    if (role === "cadence" && stepInBar === 14) synth.scheduleSnare(when, 0.7);
    if ((section === "a" || section === "b") && silenceBeats < 8) {
      const hat = arrival && stepInBar === 0 ? "open" : hatForStep(currentTension, stepInBar);
      if (hat) {
        const swing = hatSwingSeconds(log.worldId, stepInBar, beatSec);
        synth.scheduleHat(when + swing, hat === "open");
      }
    }
  }
  const endingBeat = bars * 4;
  if (includesBeat(endingBeat)) synth.scheduleEnding(startTime + endingBeat * beatSec);
}

export async function renderTakeToWav(log) {
  const duration = log.bars * 4 * (60 / log.bpm) + 4;
  const sampleRate = 44100;
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const synth = createSynth(context, {
    worldId: log.worldId,
    scaleId: resolveScaleId(log.worldId, log.scaleId),
    bpm: log.bpm,
    seed: log.seed,
  });
  const beatSec = 60 / log.bpm;
  const barsAtSuspendFrame = new Map();

  scheduleRecordedTake(context, synth, log, 0, 0, 4);
  for (let bar = 1; bar <= log.bars; bar += 1) {
    const suspendTime = bar * 4 * beatSec - 0.1;
    const suspendFrame = Math.ceil((suspendTime * sampleRate) / 128) * 128;
    const bars = barsAtSuspendFrame.get(suspendFrame) ?? [];
    bars.push(bar);
    barsAtSuspendFrame.set(suspendFrame, bars);
  }

  const suspensionTasks = [...barsAtSuspendFrame].map(async ([suspendFrame, bars]) => {
    await context.suspend(suspendFrame / sampleRate);
    try {
      bars.forEach((bar) => {
        const toBeat = bar < log.bars ? (bar + 1) * 4 : Infinity;
        scheduleRecordedTake(context, synth, log, 0, bar * 4, toBeat);
      });
    } finally {
      await context.resume();
    }
  });
  const rendering = context.startRendering();
  await Promise.all(suspensionTasks);
  const buffer = await rendering;
  return audioBufferToWav(buffer);
}

export function audioBufferToWav(buffer) {
  const channelCount = 2;
  const bytesPerSample = 2;
  const frameCount = buffer.length;
  const dataLength = frameCount * channelCount * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))];

  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return arrayBuffer;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTakeJson(log) {
  downloadBlob(new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }), "gravity-take.json");
}

export async function downloadTakeWav(log) {
  const wav = await renderTakeToWav(log);
  downloadBlob(new Blob([wav], { type: "audio/wav" }), "gravity-take.wav");
}
