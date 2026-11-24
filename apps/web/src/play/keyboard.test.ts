import { expect, it } from "vitest";
import { defaultBindings, isDrivingKey, keyboardInput, readBindings } from "./keyboard.ts";

it("validates remaps, preserves aliases and keeps brake and assistance authoritative", () => {
  expect(readBindings({ ...defaultBindings, brake: "KeyA" })).toEqual(defaultBindings);
  expect(readBindings({ ...defaultBindings, boost: "<script>" })).toEqual(defaultBindings);
  const custom = readBindings({
    left: "KeyJ",
    right: "KeyL",
    throttle: "KeyI",
    brake: "KeyK",
    boost: "Space",
  });
  expect(keyboardInput(new Set(["KeyL", "KeyI", "Space"]), custom, true)).toMatchObject({
    steer: 0.7,
    throttle: 0.35,
    boost: false,
    assist: true,
  });
  expect(keyboardInput(new Set(["KeyI", "KeyK", "Space"]), custom, false)).toMatchObject({
    throttle: 0,
    brake: 1,
    boost: false,
  });
  expect(isDrivingKey("ArrowLeft", custom)).toBe(false);
  expect(keyboardInput(new Set(["ArrowUp", "ShiftRight"]), defaultBindings, false).boost).toBe(
    true,
  );
  expect(keyboardInput(new Set(["Space"]), defaultBindings, false).boost).toBe(true);
});

it("preserves unaffected aliases and gives explicit remaps priority over default aliases", () => {
  expect(isDrivingKey("ArrowUp", { ...defaultBindings, boost: "KeyN" })).toBe(true);
  expect(
    keyboardInput(new Set(["ArrowRight"]), { ...defaultBindings, left: "ArrowRight" }, false).steer,
  ).toBe(-1);
});
