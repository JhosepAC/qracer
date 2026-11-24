import { expect, it } from "vitest";
import { createRace, driving, neutralInput, stepRace } from "./index.ts";
import { createRun } from "./modes.ts";
import { awardRun, emptyProgress, unlockedPaints } from "./progress.ts";

it("derives daily challenges from UTC date, generator and rule configuration", () => {
  const daily = (date: string) => createRun(1, driving, { mode: "daily", date: new Date(date) });
  expect(daily("2026-11-23T00:00:00Z")).toEqual(daily("2026-11-23T23:59:59Z"));
  expect(daily("2026-11-24T00:00:00Z").seed).not.toBe(daily("2026-11-23T23:59:59Z").seed);
  const normal = createRun(310, driving, { mode: "time-trial" });
  expect(normal.category).not.toBe(
    createRun(310, driving, { mode: "time-trial", assisted: true }).category,
  );
  expect(normal.category).not.toBe(
    createRun(310, { ...driving, maximum: 40 }, { mode: "time-trial" }).category,
  );
});

it("ends timed modes at exactly 120 simulation seconds and excludes countdown", () => {
  for (const mode of ["time-trial", "daily"] as const) {
    let race = createRace(310, { ...driving, integrity: 1000 }, { mode });
    for (let i = 0; i < 180; i++) race = stepRace(race, neutralInput);
    expect(race.tick).toBe(0);
    for (let i = 0; i < 7199; i++) race = stepRace(race, neutralInput);
    expect(race.phase).toBe("racing");
    race = stepRace(race, neutralInput);
    expect(race.phase).toBe("finished");
    expect(race.tick).toBe(7200);
    expect(stepRace(race, neutralInput)).toBe(race);
  }
});

it("practice cannot grant records or paints and finished runs award only once", () => {
  const race = {
    ...createRace(),
    phase: "finished",
    score: 4000,
    overtakes: 12,
    nearMisses: 3,
    driver: { ...createRace().driver, s: 6000 },
  } as const;
  const awarded = awardRun(emptyProgress, "run-1", race);
  expect(unlockedPaints(awarded)).toEqual([true, true, true, true, true, true]);
  expect(awardRun(awarded, "run-1", race)).toBe(awarded);
  expect(
    awardRun(emptyProgress, "practice", {
      ...race,
      run: createRace(1, driving, { mode: "practice" }).run,
    }),
  ).toBe(emptyProgress);
  expect(awardRun(emptyProgress, "unfinished", createRace())).toBe(emptyProgress);
});
