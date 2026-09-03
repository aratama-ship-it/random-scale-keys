import test from "node:test";
import assert from "node:assert/strict";

import { exportTimestamp, wavFilename } from "../stems.js";
import { midiFilename } from "../midi.js";

test("export filenames contain world, seed, local date, and output kind", () => {
  const date = new Date(2026, 8, 4, 9, 7);
  const log = { worldId: "daylight", seed: "abc123" };
  assert.equal(exportTimestamp(date), "20260904-0907");
  assert.equal(wavFilename(log, "lead", date), "rsk_daylight_abc123_20260904-0907_lead.wav");
  assert.equal(wavFilename(log, "accomp", date), "rsk_daylight_abc123_20260904-0907_accomp.wav");
  assert.equal(wavFilename(log, "fx", date), "rsk_daylight_abc123_20260904-0907_fx.wav");
  assert.equal(wavFilename(log, "mix", date), "rsk_daylight_abc123_20260904-0907_mix.wav");
  assert.equal(midiFilename(log, date), "rsk_daylight_abc123_20260904-0907.mid");
});
