import {
  chordMidiNotes,
  cutoffForTension,
  getWorld,
  mulberry32,
  padDetuneForTension,
  resolveScaleId,
  tonicChordForScale,
} from "./gravity.mjs";

const MIN_GAIN = 0.0001;
const MASTER_INPUT_GAIN = 1.25;
const LEAD_BUS_GAIN = 1.55;
const ACCOMP_BUS_GAIN = 0.62;
const PAD_REVERB_MULTIPLIER = 1.2;

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function connectWithReverb(source, dryDestination, reverbInput) {
  source.connect(dryDestination);
  source.connect(reverbInput);
}

function scheduleEnvelope(param, when, attack, decay, sustain, hold, release, peak = 1) {
  const attackEnd = when + attack;
  const decayEnd = attackEnd + decay;
  const releaseStart = Math.max(decayEnd, when + hold);
  param.setValueAtTime(MIN_GAIN, when);
  param.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak), attackEnd);
  param.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak * sustain), decayEnd);
  param.setValueAtTime(Math.max(MIN_GAIN, peak * sustain), releaseStart);
  param.exponentialRampToValueAtTime(MIN_GAIN, releaseStart + release);
  return releaseStart + release;
}

function makeImpulseResponse(context, random) {
  const duration = 3;
  const predelay = 0.02;
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * duration), context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const time = index / context.sampleRate;
      data[index] = time < predelay
        ? 0
        : (random() * 2 - 1) * Math.exp((-6 * (time - predelay)) / (duration - predelay));
    }
  }
  return buffer;
}

function makeSaturationCurve(length = 2048) {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const input = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.tanh(input * 1.4);
  }
  return curve;
}

function whiteNoiseBuffer(context, duration, random) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = random() * 2 - 1;
  }
  return buffer;
}

export function createSynth(context, { worldId, scaleId: requestedScaleId, bpm, destination = context.destination, seed = 1, stem = null }) {
  if (stem !== null && !["lead", "accomp", "fx"].includes(stem)) {
    throw new TypeError(`Unknown stem: ${stem}`);
  }
  const world = getWorld(worldId);
  const scaleId = resolveScaleId(worldId, requestedScaleId);
  const beatSec = 60 / bpm;
  const isStem = stem !== null;
  const impulseRandom = mulberry32(seed);
  const drumRandom = mulberry32(seed + 1);
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const saturator = context.createWaveShaper();
  const reverbInput = context.createGain();
  const convolver = context.createConvolver();
  const reverbHighpass = context.createBiquadFilter();
  const reverbLowpass = context.createBiquadFilter();
  const reverbOutput = context.createGain();
  const padBus = context.createGain();
  const padReverbSend = context.createGain();
  const leadBus = context.createGain();
  const accompBus = context.createGain();
  const clickBus = context.createGain();
  const leadDryOutput = context.createGain();
  const accompDryOutput = context.createGain();
  const fxOutput = context.createGain();
  const delayInput = context.createGain();
  const delayLeft = context.createDelay(4);
  const delayRight = context.createDelay(4);
  const feedbackLeftToRight = context.createGain();
  const feedbackRightToLeft = context.createGain();
  const delayMerger = context.createChannelMerger(2);
  const delayLowpass = context.createBiquadFilter();
  const delayOutput = context.createGain();

  master.gain.value = MASTER_INPUT_GAIN;
  compressor.threshold.value = -14;
  compressor.knee.value = 6;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;
  saturator.curve = makeSaturationCurve();
  saturator.oversample = "2x";
  if (isStem) {
    master.connect(destination);
  } else {
    master.connect(compressor);
    compressor.connect(saturator);
    saturator.connect(destination);
  }

  leadDryOutput.gain.value = stem === "lead" ? 1 : 0;
  accompDryOutput.gain.value = stem === "accomp" ? 1 : 0;
  fxOutput.gain.value = stem === "fx" ? 1 : 0;
  clickBus.gain.value = isStem ? 0 : 1;

  convolver.buffer = makeImpulseResponse(context, impulseRandom);
  reverbInput.gain.value = 0.2;
  reverbInput.connect(convolver);
  reverbHighpass.type = "highpass";
  reverbHighpass.frequency.value = 200;
  reverbLowpass.type = "lowpass";
  reverbLowpass.frequency.value = 3800;
  convolver.connect(reverbHighpass);
  reverbHighpass.connect(reverbLowpass);
  reverbLowpass.connect(reverbOutput);
  reverbOutput.gain.value = 0.35;
  reverbOutput.connect(isStem ? fxOutput : master);

  padBus.gain.value = 1;
  padBus.connect(accompBus);
  padBus.connect(padReverbSend);
  padReverbSend.gain.value = ACCOMP_BUS_GAIN * PAD_REVERB_MULTIPLIER;
  padReverbSend.connect(reverbInput);
  leadBus.gain.value = LEAD_BUS_GAIN;
  leadBus.connect(isStem ? leadDryOutput : master);
  leadBus.connect(reverbInput);
  accompBus.gain.value = ACCOMP_BUS_GAIN;
  accompBus.connect(isStem ? accompDryOutput : master);
  clickBus.connect(accompDryOutput);
  leadDryOutput.connect(master);
  accompDryOutput.connect(master);
  fxOutput.connect(master);

  delayLeft.delayTime.value = beatSec * 0.75;
  delayRight.delayTime.value = beatSec * 0.75;
  feedbackLeftToRight.gain.value = 0.35;
  feedbackRightToLeft.gain.value = 0.35;
  delayOutput.gain.value = 0.3;
  delayLowpass.type = "lowpass";
  delayLowpass.frequency.value = 3000;
  delayInput.connect(delayLeft);
  delayLeft.connect(delayMerger, 0, 0);
  delayLeft.connect(feedbackLeftToRight);
  feedbackLeftToRight.connect(delayRight);
  delayRight.connect(delayMerger, 0, 1);
  delayRight.connect(feedbackRightToLeft);
  feedbackRightToLeft.connect(delayLeft);
  delayMerger.connect(delayLowpass);
  delayLowpass.connect(delayOutput);
  delayOutput.connect(isStem ? fxOutput : master);
  delayOutput.connect(reverbInput);

  const accompDestination = accompBus;
  const clickDestination = isStem ? clickBus : master;

  function voice({ midi, type, detune = 0, gain = 1, when, length, envelope, destinationNode = master, reverb = true, filter, delaySend = false, pan = null }) {
    const oscillator = context.createOscillator();
    const amplitude = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), when);
    oscillator.detune.setValueAtTime(detune, when);
    const end = scheduleEnvelope(
      amplitude.gain,
      when,
      envelope.attack,
      envelope.decay,
      envelope.sustain,
      length,
      envelope.release,
      gain,
    );
    oscillator.connect(amplitude);
    let output = amplitude;
    if (filter) {
      const filterNode = context.createBiquadFilter();
      filterNode.type = filter.type ?? "lowpass";
      filterNode.Q.value = filter.q ?? 0.7;
      if (filter.sweep) {
        filterNode.frequency.setValueAtTime(400, when);
        filterNode.frequency.exponentialRampToValueAtTime(4000, when + 0.3);
      } else if (filter.envelope) {
        filterNode.frequency.setValueAtTime(Math.min(8000, filter.cutoff * 1.8), when);
        filterNode.frequency.exponentialRampToValueAtTime(filter.cutoff, when + 0.4);
      } else {
        filterNode.frequency.setValueAtTime(filter.cutoff, when);
      }
      amplitude.connect(filterNode);
      output = filterNode;
    }
    if (pan !== null) {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      output.connect(panner);
      output = panner;
    }
    if (reverb) connectWithReverb(output, destinationNode, reverbInput);
    else output.connect(destinationNode);
    if (delaySend) output.connect(delayInput);
    oscillator.start(when);
    oscillator.stop(end + 0.02);
  }

  function fmElectricPiano({ midi, gain, modulationIndex, when, length, envelope, filter, delaySend, destinationNode = leadBus }) {
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulationGain = context.createGain();
    const amplitude = context.createGain();
    const lowpass = context.createBiquadFilter();
    const frequency = midiToFrequency(midi);
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(frequency, when);
    modulator.type = "sine";
    modulator.frequency.setValueAtTime(frequency * 2, when);
    modulationGain.gain.setValueAtTime(Math.max(40, modulationIndex), when);
    modulationGain.gain.exponentialRampToValueAtTime(40, when + 0.25);
    const end = scheduleEnvelope(
      amplitude.gain,
      when,
      envelope.attack,
      envelope.decay,
      envelope.sustain,
      length,
      envelope.release,
      gain,
    );
    lowpass.type = "lowpass";
    lowpass.Q.value = 0.7;
    if (filter.sweep) {
      lowpass.frequency.setValueAtTime(400, when);
      lowpass.frequency.exponentialRampToValueAtTime(4000, when + 0.3);
    } else {
      lowpass.frequency.setValueAtTime(filter.cutoff, when);
    }
    modulator.connect(modulationGain);
    modulationGain.connect(carrier.frequency);
    carrier.connect(amplitude);
    amplitude.connect(lowpass);
    lowpass.connect(destinationNode);
    if (destinationNode !== leadBus) lowpass.connect(reverbInput);
    if (delaySend) lowpass.connect(delayInput);
    carrier.start(when);
    modulator.start(when);
    carrier.stop(end + 0.02);
    modulator.stop(end + 0.02);
  }

  function scheduleLead(note, when, length, velocity, effect = "none", tension = 0, options = {}) {
    const envelope = worldId === "daylight"
      ? { attack: 0.005, decay: 0.35, sustain: 0.2, release: 0.25 }
      : { attack: 0.008, decay: 0.5, sustain: 0.3, release: 0.6 };
    if (options.release !== undefined) envelope.release = options.release;
    const destinationNode = isStem && options.stemRole === "accomp" ? accompBus : leadBus;
    const scheduleSingle = (time, gainScale = 1) => {
      const cutoff = cutoffForTension(tension, options.cutoffMinimum ?? 1200);
      const filter = {
        cutoff,
        sweep: effect === "sweep",
        q: worldId === "night" ? 4 : 0.7,
        envelope: worldId === "night" && effect !== "sweep",
      };
      if (worldId === "daylight") {
        fmElectricPiano({
          midi: note.midi,
          gain: velocity * gainScale * 0.2,
          modulationIndex: 300 * velocity * gainScale,
          when: time,
          length,
          envelope,
          filter,
          delaySend: effect === "delay",
          destinationNode,
        });
        voice({ midi: note.midi + 12, type: "sine", gain: velocity * gainScale * 0.2 * 0.18, when: time, length, envelope, destinationNode, reverb: destinationNode !== leadBus, filter, delaySend: effect === "delay" });
      } else {
        voice({ midi: note.midi, type: "sawtooth", detune: -6, gain: velocity * gainScale * 0.12, when: time, length, envelope, destinationNode, reverb: destinationNode !== leadBus, filter, delaySend: effect === "delay" });
        voice({ midi: note.midi, type: "sawtooth", detune: 6, gain: velocity * gainScale * 0.12, when: time, length, envelope, destinationNode, reverb: destinationNode !== leadBus, filter, delaySend: effect === "delay" });
      }
      if (effect === "octave") {
        voice({ midi: note.midi + 12, type: "sine", gain: velocity * gainScale * 0.3 * 0.2, when: time, length, envelope, destinationNode, reverb: destinationNode !== leadBus, filter });
      }
    };
    if (effect === "stutter") {
      [1, 0.7, 0.5].forEach((scale, index) => scheduleSingle(when + index * beatSec / 8, scale));
    } else {
      scheduleSingle(when);
    }
  }

  function schedulePad(chordName, when, duration, tension = 0, options = {}) {
    const notes = options.voices ?? chordMidiNotes(worldId, scaleId, chordName, -1);
    const envelope = worldId === "daylight"
      ? { attack: 0.8, decay: 0.01, sustain: 1, release: 1.5 }
      : { attack: 1.2, decay: 0.01, sustain: 1, release: 2 };
    if (options.release !== undefined) envelope.release = options.release;
    const gain = (worldId === "daylight" ? 0.12 : 0.1) * (options.gainScale ?? 1);
    const detune = padDetuneForTension(tension);
    const scheduleChordVoices = (midiOffset, layerGain) => notes.forEach((midi, index) => {
      if (worldId === "daylight") {
        const voiceDetune = index === 0 ? -detune : index === 2 ? detune : 0;
        voice({ midi: midi + midiOffset, type: "triangle", detune: voiceDetune, gain: gain * layerGain / 6, when, length: duration, envelope, destinationNode: padBus, reverb: false, filter: { cutoff: 2000 }, pan: -0.3 });
        voice({ midi: midi + midiOffset, type: "triangle", detune: voiceDetune, gain: gain * layerGain / 6, when, length: duration, envelope, destinationNode: padBus, reverb: false, filter: { cutoff: 2000 }, pan: 0.3 });
      } else {
        const voiceDetune = index === 0 ? -detune : index === 2 ? detune : 0;
        voice({ midi: midi + midiOffset, type: "sine", detune: voiceDetune, gain: gain * layerGain / 6, when, length: duration, envelope, destinationNode: padBus, reverb: false, filter: { cutoff: 1500 }, pan: -0.3 });
        voice({ midi: midi + midiOffset, type: "triangle", detune: voiceDetune, gain: gain * layerGain / 6, when, length: duration, envelope, destinationNode: padBus, reverb: false, filter: { cutoff: 1500 }, pan: 0.3 });
      }
    });
    scheduleChordVoices(0, 1);
    if (options.octaveLayer) scheduleChordVoices(12, 0.5);
  }

  function scheduleBass(midi, when, duration = 0.28, gainScale = 1, release = 0.04) {
    const envelope = { attack: 0.005, decay: 0.08, sustain: 0.65, release };
    const gain = 0.16 * gainScale;
    const filter = { type: "highpass", cutoff: 45 };
    voice({ midi, type: "sine", gain, when, length: duration, envelope, destinationNode: accompDestination, reverb: false, filter });
    voice({ midi, type: "triangle", gain: gain * 0.10, when, length: duration, envelope, destinationNode: accompDestination, reverb: false, filter });
  }

  function duckForKick(when) {
    [[padBus.gain, 1], [leadBus.gain, LEAD_BUS_GAIN]].forEach(([gain, base]) => {
      gain.cancelScheduledValues(when);
      gain.setValueAtTime(base, when);
      gain.linearRampToValueAtTime(base * 0.7, when + 0.01);
      gain.linearRampToValueAtTime(base, when + 0.16);
    });
  }

  function scheduleKick(when) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(150, when);
    oscillator.frequency.exponentialRampToValueAtTime(50, when + 0.10);
    gain.gain.setValueAtTime(0.5, when);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + 0.10);
    oscillator.connect(gain);
    gain.connect(accompDestination);
    const click = context.createBufferSource();
    const clickGain = context.createGain();
    click.buffer = whiteNoiseBuffer(context, 0.005, drumRandom);
    clickGain.gain.setValueAtTime(0.35, when);
    clickGain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + 0.005);
    click.connect(clickGain);
    clickGain.connect(accompDestination);
    duckForKick(when);
    oscillator.start(when);
    oscillator.stop(when + 0.10);
    click.start(when);
    click.stop(when + 0.006);
  }

  function scheduleSnare(when, gainScale = 1) {
    const noise = context.createBufferSource();
    const bandpass = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const body = context.createOscillator();
    const bodyGain = context.createGain();
    noise.buffer = whiteNoiseBuffer(context, 0.12, drumRandom);
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1800;
    bandpass.Q.value = 0.8;
    noiseGain.gain.setValueAtTime(0.30 * gainScale, when);
    noiseGain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + 0.12);
    body.type = "sine";
    body.frequency.setValueAtTime(180, when);
    body.frequency.exponentialRampToValueAtTime(120, when + 0.08);
    bodyGain.gain.setValueAtTime(0.3 * gainScale, when);
    bodyGain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + 0.08);
    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(accompDestination);
    body.connect(bodyGain);
    bodyGain.connect(accompDestination);
    noise.start(when);
    noise.stop(when + 0.13);
    body.start(when);
    body.stop(when + 0.09);
  }

  function scheduleHat(when, open = false) {
    const duration = open ? 0.12 : 0.04;
    const source = context.createBufferSource();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    source.buffer = whiteNoiseBuffer(context, duration, drumRandom);
    highpass.type = "highpass";
    highpass.frequency.value = 7000;
    gain.gain.setValueAtTime((worldId === "night" ? 0.7 : 1) * 0.09 * 0.8 * 0.6, when);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + duration);
    source.connect(highpass);
    highpass.connect(gain);
    panner.pan.value = 0.2;
    gain.connect(panner);
    panner.connect(accompDestination);
    source.start(when);
    source.stop(when + duration);
  }

  function scheduleClick(when, accented = false) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = accented ? 1200 : 900;
    gain.gain.setValueAtTime(accented ? 0.18 : 0.11, when);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + 0.045);
    oscillator.connect(gain);
    gain.connect(clickDestination);
    oscillator.start(when);
    oscillator.stop(when + 0.05);
  }

  function scheduleResolution(rootMidi, when) {
    const envelope = { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.15 };
    const octaveOneRoot = 24 + (rootMidi % 12);
    voice({ midi: octaveOneRoot, type: "sine", gain: 0.22, when, length: 0.4, envelope, destinationNode: accompDestination, reverb: false });
    padBus.gain.cancelScheduledValues(when);
    padBus.gain.setValueAtTime(1.5, when);
    padBus.gain.linearRampToValueAtTime(1, when + beatSec);
    reverbInput.gain.cancelScheduledValues(when);
    reverbInput.gain.setValueAtTime(0.8, when);
    reverbInput.gain.linearRampToValueAtTime(0.2, when + beatSec * 2);
  }

  function scheduleEnding(when) {
    const tonic = tonicChordForScale(scaleId);
    const rootMidi = world.rootMidi;
    schedulePad(tonic, when, 0.1, 0, { release: 2.5 });
    scheduleLead({ midi: rootMidi }, when, 0.1, 0.45, "none", 0, { release: 2.5, stemRole: "accomp" });
    scheduleBass(24 + (rootMidi % 12), when, 0.1, 1, 2.5);
  }

  function setReverbSend(value, when, rampDuration = 0) {
    reverbInput.gain.cancelScheduledValues(when);
    reverbInput.gain.setValueAtTime(reverbInput.gain.value, when);
    if (rampDuration > 0) reverbInput.gain.linearRampToValueAtTime(value, when + rampDuration);
    else reverbInput.gain.setValueAtTime(value, when);
  }

  return {
    context,
    worldId,
    scaleId,
    bpm,
    beatSec,
    scheduleLead,
    schedulePad,
    scheduleBass,
    scheduleKick,
    scheduleSnare,
    scheduleHat,
    scheduleClick,
    scheduleResolution,
    scheduleEnding,
    setReverbSend,
  };
}
