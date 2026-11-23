import { expect, it } from "vitest";
import { sweptClearance } from "./collision.ts";
import {
  createRace,
  FixedClock,
  laneCenters,
  neutralInput,
  openLane,
  type Race,
  stepRace,
} from "./index.ts";

it("sweeps both axes and rejects lateral overlap outside the longitudinal window", () => {
  expect(sweptClearance(-20, 20, -3, 3)).toBe(0);
  expect(sweptClearance(-20, 20, 2.1, 2.1)).toBe(2.1);
  expect(sweptClearance(-10, -5, 0, 0)).toBe(Infinity);
  expect(sweptClearance(-12, 8, -8, 0)).toBeCloseTo(1.52);
});

function encounter(d: number, secondCar = false): Race {
  const first = createRace();
  return {
    ...first,
    phase: "racing",
    driver: { ...first.driver, d, speed: 22 },
    traffic: {
      nextRow: 100,
      rows: [
        { s: 5, tick: 0, cars: [{ id: 1, d: 0, paint: 0 }] },
        ...(secondCar ? [{ s: 16, tick: 0, cars: [{ id: 2, d: 0, paint: 0 }] }] : []),
      ],
    },
  };
}

it("applies damage once, protects through a second impact and ends at zero integrity", () => {
  let state = encounter(0, true);
  const events: string[] = [];
  for (let i = 0; i < 201; i++) {
    state = stepRace(state, neutralInput);
    events.push(...state.events.map((event) => event.type));
  }
  expect(state.driver.integrity).toBe(2);
  expect(events).toEqual(["impact"]);
  expect(state.score).toBe(Math.floor(state.driver.s));

  state = encounter(0);
  state = { ...state, driver: { ...state.driver, integrity: 1 } };
  while (state.phase === "racing") state = stepRace(state, neutralInput);
  expect(state.driver.integrity).toBe(0);
  expect(stepRace(state, neutralInput)).toBe(state);
});

it("records a single near miss and a single clean rebase, and distinguishes a graze", () => {
  let close = encounter(2.15);
  let graze = encounter(1.8);
  for (let i = 0; i < 130; i++) {
    close = stepRace(close, neutralInput);
    graze = stepRace(graze, neutralInput);
  }
  expect(close.overtakes).toBe(1);
  expect(close.nearMisses).toBe(1);
  expect(close.score).toBe(Math.floor(close.driver.s) + 150);
  expect(graze.driver.integrity).toBe(3);
  expect(graze.overtakes).toBe(0);
  expect(graze.nearMisses).toBe(0);
});

it("replays a full seeded race at 30/60/120 Hz and resets after suspension", () => {
  const seed = 310;
  const d = laneCenters[openLane(seed)]!;
  function replay(hz: number) {
    const events: unknown[] = [];
    const clock = new FixedClock(createRace(seed), (before) => {
      const state = stepRace(before, {
        throttle: 1,
        brake: before.tick % 420 < 60 ? 1 : 0,
        boost: before.tick % 300 < 100,
        steer: Math.max(
          -1,
          Math.min(1, (d - before.driver.d) * 0.65 - before.driver.lateral * 0.22),
        ),
      });
      events.push(...state.events);
      return state;
    });
    for (let frame = 0; frame <= hz * 30; frame++) clock.frame((frame * 1000) / hz);
    expect(clock.tick).toBe(1800);
    expect(clock.current.phase).toBe("racing");
    expect(clock.current.overtakes).toBeGreaterThan(0);
    const end = clock.current;
    clock.frame(200_000);
    expect(clock.paused).toBe(true);
    expect(clock.current).toBe(end);
    clock.reset(createRace(seed));
    expect(clock.current).toEqual(createRace(seed));
    expect(clock.tick).toBe(0);
    return { end, events };
  }
  const reference = replay(60);
  expect(replay(30)).toEqual(reference);
  expect(replay(120)).toEqual(reference);
});
