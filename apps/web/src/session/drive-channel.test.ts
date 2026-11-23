import { neutral } from "@qracer/session-core/wire";
import { expect, it } from "vitest";
import { ClockSync, RemoteInput } from "./drive-channel.ts";

function measure(clock: ClockSync, t0: number, latency: number) {
  const request = clock.request(t0);
  if (!request) throw new Error("Missing probe");
  const t1 = t0 + latency + 9200;
  clock.answer({ type: "SYNC_REPLY", epoch: 1, ...request, t1, t2: t1 + 2 }, t0 + latency * 2 + 2);
}

it("uses four timestamps and rejects stale, future and uncertain inputs", () => {
  const clock = new ClockSync();
  for (const [i, delay] of [40, 12, 17].entries()) measure(clock, i * 500, delay);
  expect(clock.estimate(1050)).toMatchObject({ offset: 9200, rtt: 24, uncertainty: 13 });
  expect(clock.receiveTime(10230, 1050)).toBe(1030);
  expect(clock.receiveTime(10000, 1050)).toBeUndefined();
  expect(clock.receiveTime(11000, 1050)).toBeUndefined();
  expect(clock.receiveTime(10230, 10000)).toBeUndefined();
  const lag = new ClockSync();
  for (let i = 0; i < 3; i++) measure(lag, i * 500, 60);
  expect(lag.receiveTime(10230, 1150)).toBeUndefined();
});

it("never refreshes on replay and neutralizes before the watchdog pause", () => {
  const remote = new RemoteInput();
  remote.configure(3);
  const frame = {
    type: "INPUT",
    seq: 1,
    epoch: 3,
    captured: 100,
    input: { ...neutral, throttle: 1, steer: 1, assist: true },
  } as const;
  remote.accept(frame, 100, 110);
  remote.accept(frame, 200, 220);
  remote.accept({ ...frame, seq: 2, epoch: 2 }, 200, 220);
  expect(remote.get(249)).toMatchObject({ throttle: 0.35, steer: 0.7 });
  expect(remote.get(250)).toBe(neutral);
  expect(remote.timedOut(349)).toBe(false);
  expect(remote.timedOut(350)).toBe(true);
  remote.configure(4);
  expect(remote.ready(350)).toBe(false);
});
