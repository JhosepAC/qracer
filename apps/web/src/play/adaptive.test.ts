import { describe, expect, it } from "vitest";
import { ResolutionGovernor } from "./adaptive.ts";

function advance(policy: ResolutionGovernor, start: number, seconds: number, interval = 40) {
  for (let now = start + 20; now <= start + seconds * 1000; now += 20)
    policy.sample(now, interval, 2);
}
describe("adaptive internal resolution", () => {
  it("waits five sustained seconds, clamps its floor and restores only after twenty stable seconds", () => {
    const policy = new ResolutionGovernor("balanced");
    advance(policy, 0, 4);
    expect(policy.scale).toBe(1);
    advance(policy, 4000, 1);
    expect(policy.scale).toBe(0.9);
    advance(policy, 5000, 25);
    expect(policy.scale).toBe(0.75);
    advance(policy, 30000, 19, 16.7);
    expect(policy.scale).toBe(0.75);
    advance(policy, 49000, 2, 16.7);
    expect(policy.scale).toBe(0.8);
    advance(policy, 51000, 60, 16.7);
    expect(policy.scale).toBe(1);
  });
  it("does not count suspended or invalid frames as overload or recovery", () => {
    const policy = new ResolutionGovernor("low");
    advance(policy, 0, 4);
    policy.sample(9000, 5000, 3);
    advance(policy, 9000, 4);
    expect(policy.scale).toBe(1);
    policy.pause();
    advance(policy, 50000, 10);
    expect(policy.scale).toBe(0.8);
    policy.sample(61000, NaN, 1);
    policy.sample(62000, 16, 2, false);
    expect(policy.scale).toBe(1);
  });
  it("preserves native 60 Hz quantization and does not recover while CPU has no margin", () => {
    const policy = new ResolutionGovernor("high");
    advance(policy, 0, 30, 16.8);
    expect(policy.scale).toBe(1);
    advance(policy, 30000, 6);
    expect(policy.scale).toBe(0.9);
    for (let now = 36020; now <= 66000; now += 20) policy.sample(now, 16.7, 12);
    expect(policy.scale).toBe(0.9);
  });
});
