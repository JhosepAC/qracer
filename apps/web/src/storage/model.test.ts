import { expect, it } from "vitest";
import { createRace } from "@qracer/game-core";
import { addResult, DataFault, freshData, readData, summarize } from "./model.ts";
const result = (id: string, score = 100) =>
  summarize(id, {
    ...createRace(),
    phase: "finished",
    score,
    driver: { ...createRace().driver, s: 1000 },
    overtakes: 2,
    nearMisses: 1,
  });
it("migrates the supported plain progress without dropping versioned records", () => {
  const state = addResult(freshData(), result("first"));
  expect(readData(state.progress)).toEqual({ ...state, history: [] });
  expect(() => readData({ ...state, schemaVersion: 3 })).toThrow(new DataFault("future"));
});
it("bounds retention, keeps the principal best and awards each recent run once", () => {
  let state = addResult(freshData(), result("first", 99999));
  expect(addResult(state, result("first", 99999))).toBe(state);
  for (let i = 0; i < 110; i++) {
    const row = result(`run-${i}`, i);
    row.category = row.category.replace("/310/", `/${i}/`);
    row.seed = i;
    state = addResult(state, row);
  }
  expect(Object.keys(state.progress.records)).toHaveLength(100);
  expect(Math.max(...Object.values(state.progress.records))).toBe(99999);
  expect(state.history).toHaveLength(20);
  expect(readData(state)).toEqual(state);
});
it("keeps practice out of rewards and isolates assisted categories", () => {
  const practice = {
    ...result("practice"),
    mode: "practice" as const,
    category: result("practice").category.replace("infinite/", "practice/"),
  };
  const state = addResult(freshData(), practice);
  expect(state.progress.distance).toBe(0);
  expect(state.progress.records).toEqual({});
  const normal = addResult(state, result("normal"));
  const helped = {
    ...result("helped"),
    assisted: true,
    category: result("helped").category.replace(/standard$/, "assisted"),
  };
  expect(Object.keys(addResult(normal, helped).progress.records)).toHaveLength(2);
});
it("rejects corrupt, oversized and prototype-shaped data instead of merging it", () => {
  const clean = freshData();
  for (const value of [
    { ...clean, secret: "token" },
    { ...clean, progress: { ...clean.progress, distance: Infinity } },
    { ...clean, history: Array(21).fill(result("x")) },
    JSON.parse('{"schemaVersion":2,"__proto__":{"polluted":true}}'),
  ])
    expect(() => readData(value)).toThrow();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
