import { expect, it } from "vitest";
import { TouchInput } from "./touch.ts";

it("keeps independent touches, gives brake priority, and clears cancellations", () => {
  const touch = new TouchInput();
  expect(touch.down(7, "wheel", 0.3)).toBe(true);
  expect(touch.down(8, "wheel", -1)).toBe(false);
  touch.down(1, "throttle");
  expect(touch.snapshot()).toMatchObject({ steer: 0.3, throttle: 1 });
  touch.down(2, "brake");
  touch.down(3, "boost");
  expect(touch.snapshot()).toMatchObject({ throttle: 0, brake: 1, boost: false });
  touch.up(2);
  touch.up(7);
  expect(touch.snapshot()).toMatchObject({ steer: 0, throttle: 1, boost: true });
  touch.clear();
  expect(touch.snapshot()).toMatchObject({ steer: 0, throttle: 0, brake: 0, boost: false });
});
