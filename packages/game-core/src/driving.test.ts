import { describe, expect, it } from "vitest";
import { drive, driving, FixedClock, initialDriver, neutralInput } from "./index.ts";

describe("fixed step driving", () => {
  it("replays identical tick inputs at 30, 60 and 120 Hz", () => {
    function replay(hz: number) {
      const clock = new FixedClock(initialDriver(), (state, tick) =>
        drive(state, {
          steer: Math.sin(tick / 30),
          throttle: tick < 420 ? 1 : 0,
          brake: tick >= 480 ? 1 : 0,
          boost: tick > 120 && tick < 360,
        }),
      );
      for (let frame = 0; frame <= hz * 10; frame++) clock.frame((frame * 1000) / hz);
      expect(clock.tick).toBe(600);
      return clock.current;
    }
    expect(replay(30)).toEqual(replay(60));
    expect(replay(120)).toEqual(replay(60));
  });

  it("caps catch up and pauses on suspension without accumulating time", () => {
    const clock = new FixedClock(0, (count) => count + 1);
    clock.frame(0);
    clock.frame(200);
    expect(clock.current).toBe(5);
    clock.frame(70_000);
    expect(clock.paused).toBe(true);
    clock.resume();
    clock.frame(80_000);
    expect(clock.current).toBe(5);
    clock.frame(80_020);
    expect(clock.current).toBe(6);
  });

  it("bounds speed and lateral motion, gives brake priority and limits nitro", () => {
    let state = initialDriver();
    for (let i = 0; i < 600; i++)
      state = drive(state, { steer: 900, throttle: Infinity, brake: 0, boost: true });
    expect(state.d).toBeLessThan(6);
    expect(state.lateral).toBe(0);
    expect(state.nitro).toBeLessThan(1 / 60);
    expect(state.speed).toBeCloseTo(driving.cruise);
    for (let i = 0; i < 240; i++)
      state = drive(state, { steer: NaN, throttle: 1, brake: 1, boost: true });
    expect(state.speed).toBeCloseTo(driving.minimum);
    expect(state.boosting).toBe(false);
    expect(drive(initialDriver(), neutralInput).s).toBeGreaterThan(0);
  });
});
