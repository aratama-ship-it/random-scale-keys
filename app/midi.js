import {
  ARPEGGIO_GAINS,
  arpeggioOffsets,
  chordMidiNotes,
  getWorld,
  resolveScaleId,
  tonicChordForScale,
} from "../prototype/gravity.mjs";
import { downloadBlob, scheduleRecordedTake } from "../prototype/render.js";
import { exportTimestamp } from "./stems.js";

export const PPQ = 480;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function uint16(value) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function uint32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function textBytes(text) {
  return [...new TextEncoder().encode(text)];
}

export function vlq(value) {
  let remaining = Math.max(0, Math.round(value));
  const bytes = [remaining & 0x7f];
  while ((remaining >>= 7) > 0) bytes.unshift((remaining & 0x7f) | 0x80);
  return bytes;
}

export function secondsToTicks(seconds, bpm) {
  return Math.round((seconds / (60 / bpm)) * PPQ);
}

export function midiVelocity(velocity) {
  return Math.round(clamp(Number(velocity) || 0, 0, 1) * 126) + 1;
}

function note(track, trackName, midi, when, length, velocity) {
  track.push({
    track: trackName,
    midi: clamp(Math.round(midi), 0, 127),
    when: Math.max(0, when),
    length: Math.max(0, length),
    velocity: midiVelocity(velocity),
  });
}

export function createMidiRecorder({ worldId, scaleId: requestedScaleId, bpm }) {
  const scaleId = resolveScaleId(worldId, requestedScaleId);
  const beatSec = 60 / bpm;
  const tracks = { lead: [], pad: [], bass: [], drums: [] };

  function scheduleLead(source, when, length, velocity, effect = "none") {
    if (effect === "arpeggio" && Number.isInteger(source.degree)) {
      const arpeggioLength = Math.max(0.12, (beatSec / 3) * 0.9);
      arpeggioOffsets(scaleId, source.degree).forEach((midiOffset, index) => {
        note(
          tracks.lead,
          "lead",
          source.midi + midiOffset,
          when + index * beatSec / 3,
          arpeggioLength,
          velocity * ARPEGGIO_GAINS[index],
        );
      });
      return;
    }
    const times = effect === "stutter"
      ? [when, when + beatSec / 8, when + beatSec / 4]
      : [when];
    times.forEach((time) => {
      note(tracks.lead, "lead", source.midi, time, length, velocity);
      if (effect === "octave") note(tracks.lead, "lead", source.midi + 12, time, length, velocity);
    });
  }

  function schedulePad(chordName, when, duration, _tension, options = {}) {
    (options.voices ?? chordMidiNotes(worldId, scaleId, chordName, -1)).forEach((midi) => {
      note(tracks.pad, "pad", midi, when, duration, options.gainScale ?? 1);
    });
  }

  function scheduleBass(midi, when, duration = 0.28, gainScale = 1) {
    note(tracks.bass, "bass", midi, when, duration, gainScale);
  }

  function scheduleDrum(midi, when, velocity = 1) {
    note(tracks.drums, "drums", midi, when, beatSec / 4, velocity);
  }

  function scheduleResolution(rootMidi, when) {
    note(tracks.bass, "bass", 24 + (rootMidi % 12), when, 0.4, 1);
  }

  function scheduleEnding(when) {
    const tonic = tonicChordForScale(scaleId);
    const rootMidi = getWorld(worldId).rootMidi;
    schedulePad(tonic, when, 0.1);
    scheduleLead({ midi: rootMidi }, when, 0.1, 0.45);
    scheduleBass(24 + (rootMidi % 12), when, 0.1, 1);
  }

  return {
    context: { currentTime: 0, sampleRate: 44100 },
    worldId,
    scaleId,
    bpm,
    beatSec,
    tracks,
    scheduleLead,
    schedulePad,
    scheduleBass,
    scheduleKick: (when) => scheduleDrum(36, when),
    scheduleSnare: (when) => scheduleDrum(38, when),
    scheduleHat: (when, open = false) => scheduleDrum(open ? 46 : 42, when),
    scheduleClick: () => {},
    scheduleResolution,
    scheduleEnding,
    setReverbSend: () => {},
  };
}

function trackChunk(name, channel, notes, bpm) {
  const nameData = textBytes(name);
  const events = [{ tick: 0, priority: 0, bytes: [0xff, 0x03, ...vlq(nameData.length), ...nameData] }];
  notes.forEach((entry) => {
    const start = secondsToTicks(entry.when, bpm);
    const end = secondsToTicks(entry.when + entry.length, bpm);
    events.push({ tick: start, priority: 2, bytes: [0x90 | channel, entry.midi, entry.velocity] });
    events.push({ tick: end, priority: 1, bytes: [0x80 | channel, entry.midi, 0] });
  });
  events.sort((left, right) => left.tick - right.tick || left.priority - right.priority || left.bytes[1] - right.bytes[1]);
  const body = [];
  let previousTick = 0;
  events.forEach((event) => {
    body.push(...vlq(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  });
  body.push(0x00, 0xff, 0x2f, 0x00);
  return [...textBytes("MTrk"), ...uint32(body.length), ...body];
}

function tempoTrack(bpm) {
  const name = textBytes("tempo");
  const microseconds = Math.round(60_000_000 / bpm);
  const body = [
    0x00, 0xff, 0x03, ...vlq(name.length), ...name,
    0x00, 0xff, 0x51, 0x03, (microseconds >>> 16) & 0xff, (microseconds >>> 8) & 0xff, microseconds & 0xff,
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
    0x00, 0xff, 0x2f, 0x00,
  ];
  return [...textBytes("MTrk"), ...uint32(body.length), ...body];
}

export function createMidiFile(log) {
  const recorder = createMidiRecorder(log);
  scheduleRecordedTake(recorder.context, recorder, log, 0);
  const chunks = [
    tempoTrack(log.bpm),
    trackChunk("lead", 0, recorder.tracks.lead, log.bpm),
    trackChunk("pad", 1, recorder.tracks.pad, log.bpm),
    trackChunk("bass", 2, recorder.tracks.bass, log.bpm),
    trackChunk("drums", 9, recorder.tracks.drums, log.bpm),
  ];
  return new Uint8Array([
    ...textBytes("MThd"), ...uint32(6), ...uint16(1), ...uint16(chunks.length), ...uint16(PPQ),
    ...chunks.flat(),
  ]);
}

export function midiFilename(log, date = new Date()) {
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
  return `rsk_${safe(log.worldId)}_${safe(log.seed)}_${exportTimestamp(date)}.mid`;
}

export function downloadTakeMidi(log, date = new Date()) {
  downloadBlob(new Blob([createMidiFile(log)], { type: "audio/midi" }), midiFilename(log, date));
}
