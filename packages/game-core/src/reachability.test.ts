import { expect, it } from "vitest";
import { drive, driving, initialDriver, neutralInput } from "./driving.ts";
import { laneCenters } from "./road.ts";
import { difficultyAt, REACTION_SECONDS, validateRoute } from "./reachability.ts";
import { advanceTraffic, openLane, TRAFFIC_LOOKAHEAD, trafficLateral } from "./traffic.ts";

it("verifies 10,000 seeds across difficulty, stationary hazards and lateral traffic envelopes", () => {
  let moving = 0;
  const kinds = new Set<number>();
  let minimumMargin = Infinity;
  for (let seed = 0; seed < 10000; seed++) {
    const safe = laneCenters[openLane(seed)] ?? 0;
    for (let row = 1; row <= 16; row++) {
      const distance = row * 800;
      const world = advanceTraffic({ nextRow: row, rows: [] }, seed, distance, 0);
      const candidate = world.rows[0];
      if (!candidate) throw new Error(`Missing row ${seed}/${row}`);
      const result = validateRoute(
        candidate.s - distance,
        safe,
        candidate.cars.map((car) => ({
          from: car.d,
          to: car.targetD ?? car.d,
          halfWidth: candidate.hazard ? 0.8 : 0.95,
        })),
      );
      if (!result.valid) throw new Error(`Unreachable ${seed}/${row}`);
      minimumMargin = Math.min(minimumMargin, result.arrival - result.required);
      for (const car of candidate.cars) {
        kinds.add(car.kind ?? 0);
        if (car.targetD !== undefined) {
          moving++;
          if (car.moveAt === undefined || car.moveAt < 2.15 * 60)
            throw new Error("Missing announcement");
          if (
            trafficLateral(car, car.moveAt) !== car.d ||
            trafficLateral(car, car.moveAt + 120) !== car.targetD
          )
            throw new Error("Unstable maneuver endpoints");
        }
      }
    }
  }
  expect(kinds.size).toBe(3);
  expect(moving).toBeGreaterThan(10000);
  expect(minimumMargin).toBeGreaterThan(1);
  expect(validateRoute(30, 0, []).valid).toBe(false);
  expect(validateRoute(360, 0, [{ from: -4, to: 4, halfWidth: 0.95 }]).valid).toBe(false);
  expect(difficultyAt(1e9)).toEqual(difficultyAt(10000));
});

it("reaches the reserved corridor using actual acceleration and steering after the reaction window", () => {
  for (const safe of laneCenters)
    for (const d of [-5.05, 0, 5.05])
      for (const lateral of [-7, 0, 7]) {
        let driver = { ...initialDriver(), d, lateral, speed: driving.boostMaximum };
        const deadline = (TRAFFIC_LOOKAHEAD - 5) / driving.boostMaximum;
        for (let tick = 0; tick < deadline * 60; tick++) {
          const steer =
            tick < REACTION_SECONDS * 60
              ? 0
              : Math.max(-1, Math.min(1, (safe - driver.d) * 2 - driver.lateral * 0.7));
          driver = drive(driver, { ...neutralInput, steer, brake: 1 });
        }
        expect(Math.abs(driver.d - safe)).toBeLessThan(0.15);
      }
});
