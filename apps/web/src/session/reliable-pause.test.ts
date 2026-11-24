import { expect, it, vi } from "vitest";
import { ReliablePause } from "./reliable-pause.ts";

it("retries only the outstanding action and requires a matching epoch and acknowledgement", () => {
  const action = new ReliablePause();
  const send = vi.fn(() => true);
  const fail = vi.fn();
  const frame = { type: "DRIVE_PAUSE", epoch: 7, seq: 1 } as const;
  action.sent(frame, 0);
  action.ack(6, 1);
  action.ack(7, 0);
  for (const time of [99, 100, 200, 300, 400]) action.tick(time, send, fail);
  expect(send).toHaveBeenCalledTimes(2);
  expect(fail).toHaveBeenCalledTimes(1);
  action.sent({ ...frame, seq: 2 }, 500);
  action.ack(7, 2);
  action.tick(600, send, fail);
  expect(send).toHaveBeenCalledTimes(2);
  action.sent(frame, 700);
  action.reset();
  action.tick(800, send, fail);
  expect(send).toHaveBeenCalledTimes(2);
});
