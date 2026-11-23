import { expect, it } from "vitest";
import { screenRoll } from "../probe/tilt.ts";
import { angularDelta, TiltFilter } from "./tilt-input.ts";

it("maps axes across both landscape rotations and wraps angular differences", () => {
  expect(screenRoll(20, 4, 0)).toBeCloseTo(4);
  expect(screenRoll(20, 4, 90)).toBeCloseTo(20);
  expect(screenRoll(20, 4, 270)).toBeCloseTo(-20);
  expect(angularDelta(-179, 179)).toBe(2);
});
it("calibrates, filters inside a physical dead zone and clears stale samples", () => {
  const filter = new TiltFilter();
  filter.update(42, 45);
  filter.update(12, 55);
  for (const time of [70, 85, 100]) filter.update(10, time);
  expect(filter.calibrated).toBe(true);
  filter.update(12.9, 130);
  expect(filter.value(130)).toBe(0);
  filter.update(35, 160);
  expect(filter.value(160)).toBeGreaterThan(0.25);
  expect(filter.value(160)).toBeLessThan(0.5);
  expect(filter.value(310)).toBe(0);
  filter.update(-13, 340);
  expect(filter.calibrated).toBe(false);
  expect(filter.value(340)).toBe(0);
});
