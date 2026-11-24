import { expect, it } from "vitest";
import { createRace } from "@qracer/game-core";
import { GhostRecorder, MAX_GHOST_SAMPLES, readGhost } from "./ghost.ts";
const initial = createRace(310, undefined, { mode: "time-trial" });
const race = (tick: number, finished = false) => ({
  ...initial,
  phase: finished ? ("finished" as const) : ("racing" as const),
  tick,
  driver: { ...initial.driver, s: tick / 3, d: tick / 12, lateral: 1 },
});
it("records at twenty Hz without duplicate paused ticks and interpolates a visual trajectory", () => {
  const recorder = new GhostRecorder(7200);
  recorder.capture(initial);
  for (let i = 0; i <= 6; i++) recorder.capture(race(i));
  recorder.capture(race(6));
  const ghost = recorder.finish(race(7, true));
  expect(recorder.samples).toBe(4);
  expect(ghost).toBeDefined();
  const replay = readGhost(ghost, initial.run.category);
  expect(replay?.at(1.5)?.s).toBeCloseTo(0.5);
  expect(replay?.at(7)?.s).toBeCloseTo(7 / 3);
  expect(replay?.at(8)).toBeUndefined();
  expect(readGhost(ghost, initial.run.category.replace(/standard$/, "assisted"))).toBeUndefined();
});
it("rejects incompatible corrupt and non-finite data without touching race state", () => {
  const recorder = new GhostRecorder(7200);
  recorder.capture(race(0));
  const ghost = recorder.finish(race(3, true));
  if (!ghost) throw new Error("Missing fixture");
  expect(readGhost({ ...ghost, schemaVersion: 2 }, ghost.category)).toBeUndefined();
  const buffer = ghost.buffer.slice(0);
  new DataView(buffer).setFloat32(20, NaN, true);
  expect(readGhost({ ...ghost, buffer }, ghost.category)).toBeUndefined();
  expect(
    readGhost({ ...ghost, buffer: ghost.buffer.slice(0, -1) }, ghost.category),
  ).toBeUndefined();
  expect(race(3, true).driver.integrity).toBe(initial.driver.integrity);
});
it("caps allocation at one MiB and never delivers an overflowed partial ghost", () => {
  const recorder = new GhostRecorder(1e12);
  for (let i = 0; i <= MAX_GHOST_SAMPLES; i++) recorder.capture({ ...race(0), tick: i * 3 });
  expect(recorder.bytes).toBeLessThanOrEqual(1024 * 1024);
  expect(recorder.samples).toBe(MAX_GHOST_SAMPLES);
  expect(recorder.finish({ ...race(3, true), tick: (MAX_GHOST_SAMPLES + 1) * 3 })).toBeUndefined();
});
