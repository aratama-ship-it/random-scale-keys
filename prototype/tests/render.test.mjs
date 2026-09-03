import test from "node:test";
import assert from "node:assert/strict";

import { partitionEventsByBar } from "../render.js";

test("partitionEventsByBar assigns boundary events exactly once, including the ending interval", () => {
  const events = [
    { id: "start", beat: 0 },
    { id: "before-first-boundary", beat: 3.999 },
    { id: "first-boundary", beat: 4 },
    { id: "before-ending", beat: 7.999 },
    { id: "ending", beat: 8 },
  ];

  const partitions = partitionEventsByBar(events, 2);

  assert.deepEqual(partitions.map((partition) => partition.map((event) => event.id)), [
    ["start", "before-first-boundary"],
    ["first-boundary", "before-ending"],
    ["ending"],
  ]);
  assert.deepEqual(partitions.flat(), events);
});
