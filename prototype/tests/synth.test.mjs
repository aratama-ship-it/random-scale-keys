import test from "node:test";
import assert from "node:assert/strict";

import { mulberry32 } from "../gravity.mjs";
import { createSynth, HOLD_MAX_SECONDS, makeSfxRoomImpulse } from "../synth.js";

function audioParam(initial = 0) {
  return {
    value: initial,
    calls: [],
    setValueAtTime(value, when) { this.value = value; this.calls.push(["set", value, when]); },
    exponentialRampToValueAtTime(value, when) { this.value = value; this.calls.push(["exponential", value, when]); },
    linearRampToValueAtTime(value, when) { this.value = value; this.calls.push(["linear", value, when]); },
    cancelScheduledValues(when) { this.calls.push(["cancel", when]); },
    cancelAndHoldAtTime(when) { this.calls.push(["hold", when]); },
  };
}

function audioNode(properties = {}) {
  return {
    connections: [],
    connect(destination) { this.connections.push(destination); return destination; },
    ...properties,
  };
}

function mockContext() {
  const gainNodes = [];
  const convolverNodes = [];
  const oscillatorNodes = [];
  const params = [];
  const param = (initial = 0) => {
    const value = audioParam(initial);
    params.push(value);
    return value;
  };
  return {
    currentTime: 0,
    sampleRate: 1000,
    destination: audioNode(),
    gainNodes,
    convolverNodes,
    oscillatorNodes,
    params,
    createBuffer(channels, length, sampleRate = this.sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (channel) => data[channel],
      };
    },
    createGain() {
      const node = audioNode({ gain: param(1) });
      gainNodes.push(node);
      return node;
    },
    createDynamicsCompressor() {
      return audioNode({
        threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
      });
    },
    createWaveShaper: () => audioNode(),
    createConvolver() {
      const node = audioNode({ buffer: null });
      convolverNodes.push(node);
      return node;
    },
    createBiquadFilter: () => audioNode({ frequency: param(), Q: param() }),
    createDelay: () => audioNode({ delayTime: param() }),
    createChannelMerger: () => audioNode(),
    createStereoPanner: () => audioNode({ pan: param() }),
    createOscillator() {
      const node = audioNode({
        frequency: param(),
        detune: param(),
        startedAt: null,
        stoppedAt: null,
        start(when) { this.startedAt = when ?? 0; },
        stop(when) { this.stoppedAt = when ?? 0; },
      });
      oscillatorNodes.push(node);
      return node;
    },
    createBufferSource: () => audioNode({ start() {}, stop() {}, buffer: null }),
  };
}

test("makeSfxRoomImpulse has the specified length, predelay, and exponential decay", () => {
  const context = mockContext();
  const impulse = makeSfxRoomImpulse(context, () => 1);
  const left = impulse.getChannelData(0);

  assert.equal(impulse.numberOfChannels, 2);
  assert.equal(impulse.length, 1400);
  assert.deepEqual(Array.from(left.slice(0, 10)), Array(10).fill(0));
  assert.ok(left[10] > left[310]);
  assert.ok(Math.abs(left[310] / left[10] - Math.exp(-1)) < 1e-6);
});

test("makeSfxRoomImpulse is deterministic and uses distinct noise per channel", () => {
  const context = mockContext();
  const first = makeSfxRoomImpulse(context, mulberry32(8));
  const second = makeSfxRoomImpulse(context, mulberry32(8));

  assert.deepEqual(first.getChannelData(0), second.getChannelData(0));
  assert.deepEqual(first.getChannelData(1), second.getChannelData(1));
  assert.notDeepEqual(first.getChannelData(0), first.getChannelData(1));
});

test("SFX buses retain the main reverb send and use separate short-room paths", () => {
  [null, "lead", "accomp", "fx"].forEach((stem) => {
    const context = mockContext();
    createSynth(context, { worldId: "daylight", bpm: 100, stem });
    const mainSend = context.gainNodes.find((node) => node.gain.value === 6);
    const sfxBuses = context.gainNodes
      .filter((node) => node.connections.includes(mainSend))
      .sort((left, right) => left.gain.value - right.gain.value);
    const roomConvolvers = context.convolverNodes.slice(1);

    assert.ok(mainSend, stem ?? "mix");
    assert.deepEqual(sfxBuses.map((node) => node.gain.value), [0.3, 0.6], stem ?? "mix");
    assert.equal(roomConvolvers.length, 2, stem ?? "mix");
    assert.equal(roomConvolvers[0].buffer, roomConvolvers[1].buffer, stem ?? "mix");
    sfxBuses.forEach((bus) => {
      const roomSend = bus.connections.find((node) => (
        node.connections?.some((destination) => roomConvolvers.includes(destination))
      ));
      const dryDestination = bus.connections.find((node) => node !== mainSend && node !== roomSend);
      const room = roomSend.connections[0];
      const wet = room.connections[0];
      assert.ok(roomConvolvers.includes(room), stem ?? "mix");
      assert.equal(wet.gain.value, 1.0, stem ?? "mix");
      assert.ok(wet.connections.includes(dryDestination), stem ?? "mix");
    });
  });
});

test("scheduleLead returns release handles only for hold-compatible effects", () => {
  const context = mockContext();
  const synth = createSynth(context, { worldId: "daylight", scaleId: "ionian", bpm: 100 });
  const handle = synth.scheduleLead(
    { midi: 60, degree: 1 },
    1,
    0.3,
    0.8,
    "none",
    0,
    { hold: "open", timbre: "epiano" },
  );
  assert.equal(typeof handle.release, "function");
  ["delay", "sweep", "octave"].forEach((effect, index) => {
    assert.equal(typeof synth.scheduleLead(
      { midi: 61 + index, degree: 1 },
      1.1 + index,
      0.3,
      0.8,
      effect,
      0,
      { timbre: "epiano" },
    ).release, "function", effect);
  });
  assert.equal(synth.scheduleLead({ midi: 60, degree: 1 }, 2, 0.3, 0.8, "stutter", 0, { hold: "open" }), null);
  assert.equal(synth.scheduleLead({ midi: 60, degree: 1 }, 3, 0.3, 0.8, "arpeggio", 0, { hold: "open" }), null);

  handle.release(99);
  const releasesAfterFirstCall = context.params.flatMap((param) => param.calls)
    .filter(([kind]) => kind === "hold");
  assert.ok(releasesAfterFirstCall.length >= 2);
  assert.ok(releasesAfterFirstCall.every(([, when]) => when === 1 + HOLD_MAX_SECONDS));
  handle.release(4);
  assert.equal(context.params.flatMap((param) => param.calls).filter(([kind]) => kind === "hold").length, releasesAfterFirstCall.length);
});

test("stutter and arpeggio close their envelopes even when hold is open", () => {
  // 2026-09-04 の不具合: ハンドルを返さない効果を開いたエンベロープで鳴らすと release が呼ばれず
  // HOLD_MAX_SECONDS 鳴り続けた（本人報告「サステインが無限ループのように残る」）
  ["stutter", "arpeggio"].forEach((effect) => {
    const context = mockContext();
    const synth = createSynth(context, { worldId: "daylight", scaleId: "ionian", bpm: 100 });
    const when = 1;
    assert.equal(
      synth.scheduleLead({ midi: 60, degree: 1 }, when, 0.3, 0.8, effect, 0, { hold: "open", timbre: "epiano" }),
      null,
      effect,
    );
    const stopTimes = context.oscillatorNodes
      .map((node) => node.stoppedAt)
      .filter((at) => Number.isFinite(at));
    assert.ok(stopTimes.length > 0, effect);
    assert.ok(
      Math.max(...stopTimes) < when + HOLD_MAX_SECONDS,
      `${effect} の発音が ${Math.max(...stopTimes)} 秒まで続く（release が呼ばれない効果なので length で閉じること）`,
    );
  });
});

test("all four lead timbres schedule without changing the effect contract", () => {
  const context = mockContext();
  const synth = createSynth(context, { worldId: "night", scaleId: "aeolian", bpm: 88 });
  ["epiano", "saw", "pluck", "bell"].forEach((timbre, index) => {
    const handle = synth.scheduleLead(
      { midi: 57 + index, degree: 1 },
      index,
      0.4,
      0.75,
      index === 3 ? "delay" : "none",
      0.4,
      { timbre },
    );
    assert.equal(typeof handle.release, "function", timbre);
  });
});

test("rootMidi option drives tapestop and ending while the world default remains available", () => {
  const midiFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const shiftedContext = mockContext();
  const shifted = createSynth(shiftedContext, { worldId: "daylight", scaleId: "ionian", bpm: 100, rootMidi: 62 });
  assert.equal(shifted.rootMidi, 62);
  shifted.scheduleSfx("tapestop", 0, 1);
  assert.deepEqual(
    shiftedContext.oscillatorNodes.slice(-3).map((node) => node.frequency.calls[0][1]),
    [midiFrequency(62), midiFrequency(62), midiFrequency(62) / 2],
  );
  shifted.scheduleEnding(2);
  assert.ok(shiftedContext.oscillatorNodes.some((node) => (
    node.frequency.calls.some(([kind, frequency, when]) => kind === "set" && frequency === midiFrequency(62) && when === 2)
  )));

  const legacy = createSynth(mockContext(), { worldId: "night", scaleId: "aeolian", bpm: 88 });
  assert.equal(legacy.rootMidi, 57);
});

test("kick and hat velocity scale their gains while drums-only ending schedules only a kick", () => {
  const context = mockContext();
  const synth = createSynth(context, { worldId: "daylight", scaleId: "ionian", bpm: 100 });
  const hasSet = (expected, when) => context.params.some((param) => param.calls.some(([kind, value, scheduledWhen]) => (
    kind === "set" && Math.abs(value - expected) < 1e-12 && scheduledWhen === when
  )));
  synth.scheduleKick(1, 0.4);
  assert.ok(hasSet(0.2, 1));
  assert.ok(hasSet(0.14, 1));
  synth.scheduleHat(2, false, 0.5);
  assert.ok(hasSet(0.0216, 2));

  const oscillatorsBeforeEnding = context.oscillatorNodes.length;
  synth.scheduleEnding(3, { drumsOnly: true });
  assert.equal(context.oscillatorNodes.length, oscillatorsBeforeEnding + 1);
  assert.ok(hasSet(0.5, 3));
});
