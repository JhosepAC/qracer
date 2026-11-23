import { expect, it } from "vitest";
import { expiredInput } from "./freshness.ts";

it("rejects a stale snapshot on the first resumed frame even if a timer never fired", () => {
  expect(expiredInput(1000, 1224.9)).toBe(false);
  expect(expiredInput(1000, 1225)).toBe(true);
  expect(expiredInput(1000, 5000)).toBe(true);
  expect(expiredInput(-Infinity, 5000)).toBe(true);
  expect(expiredInput(6000, 5000)).toBe(true);
});
