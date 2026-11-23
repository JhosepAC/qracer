import { expect, it } from "vitest";
import { screenRoll } from "./tilt.ts";

it("maps the steering axis into each screen rotation", () => {
  expect(screenRoll(30, 10, 0)).toBeCloseTo(10);
  expect(screenRoll(30, 10, 90)).toBeCloseTo(30);
  expect(screenRoll(30, 10, 180)).toBeCloseTo(-10);
  expect(screenRoll(30, 10, 270)).toBeCloseTo(-30);
});
