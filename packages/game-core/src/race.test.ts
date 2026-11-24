import { expect, it } from "vitest";
import { sweptClearance } from "./collision.ts";
import {
  advanceTraffic,
  createRace,
  driving,
  FixedClock,
  laneCenters,
  neutralInput,
  openLane,
  type Race,
  stepRace,
  trafficPosition,
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

it("keeps work zones stationary, passable and absent from overtaking rewards", () => {
  const race = encounter(3);
  const hazard = {
    s: 480,
    tick: 1000,
    cars: [{ id: 9, d: 0, paint: 0 }],
    hazard: "cones",
  } as const;
  const moving = { s: 320, tick: 0, cars: [] };
  const previous = { nextRow: 3, rows: [moving] };
  const generated = advanceTraffic(previous, race.seed, 224, 1000).rows[1];
  expect(generated).toMatchObject({ hazard: "cones", s: 584 });
  if (!generated) throw new Error("Missing work zone");
  expect(generated.cars).toHaveLength(1);
  expect(generated.cars[0]?.d).not.toBe(laneCenters[openLane(race.seed)]);
  expect(trafficPosition(generated, 2000)).toBe(584);
  expect(
    advanceTraffic({ nextRow: 100, nextSpawn: 1e9, rows: [moving, hazard] }, race.seed, 510, 2000)
      .rows,
  ).toEqual(previous.rows);

  let safe: Race = { ...race, traffic: { nextRow: 100, rows: [{ ...hazard, s: 8, tick: 0 }] } };
  let hit: Race = { ...safe, driver: { ...safe.driver, d: 0 } };
  for (let i = 0; i < 120; i++) {
    safe = stepRace(safe, neutralInput);
    hit = stepRace(hit, neutralInput);
  }
  expect(safe.driver.integrity).toBe(3);
  expect(safe.overtakes).toBe(0);
  expect(safe.nearMisses).toBe(0);
  expect(hit.driver.integrity).toBe(2);
});

it("replays a full seeded race at 30/60/120 Hz and resets after suspension", () => {
  const seed = 310;
  const d = laneCenters[openLane(seed)] ?? 0;
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

it("uses the selected balance throughout a race", () => {
  const base = createRace(310, { ...driving, integrity: 1, nitroSeconds: 1, maximum: 27 });
  let state: Race = { ...base, phase: "racing" };
  expect(state.driver.integrity).toBe(1);
  expect(state.driver.nitro).toBe(1);
  for (let i = 0; i < 180; i++) state = stepRace(state, { ...neutralInput, throttle: 1 });
  expect(state.driver.speed).toBe(27);
});
