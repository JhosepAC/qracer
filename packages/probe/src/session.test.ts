import { describe, expect, it } from "vitest";
import { credentials, parseProbeMessage, ProbeSession } from "./session.ts";

function setup() {
  const record = credentials(1000);
  const room = new ProbeSession({ credentials: record, peers: [], used: false });
  room.add("pc", 1000);
  room.add("mobile", 1000);
  return { room, record };
}
describe("F02 session boundary", () => {
  it("requires independent role credentials before forwarding input", () => {
    const { room, record } = setup();
    expect(
      room.handle("mobile", { type: "INPUT", seq: 0, steer: 1, throttle: 1, brake: 0 }, 1001).close,
    ).toBeDefined();
    expect(
      room.handle("pc", { type: "AUTH", role: "host", token: record.controllerToken }, 1001).close,
    ).toBeDefined();
    room.handle("pc", { type: "AUTH", role: "host", token: record.hostToken }, 1001);
    room.handle(
      "mobile",
      { type: "AUTH", role: "controller", token: record.controllerToken },
      1001,
    );
    const input = { type: "INPUT", seq: 1, steer: 0.5, throttle: 0.4, brake: 0 } as const;
    expect(room.handle("mobile", input, 1002).send).toEqual([{ to: "pc", body: input }]);
    expect(room.handle("mobile", input, 1003).send).toEqual([]);
    expect(room.handle("pc", input, 1004).close).toBeDefined();
  });
  it("consumes the invitation and preserves that decision across hibernation snapshots", () => {
    const { room, record } = setup();
    room.handle(
      "mobile",
      { type: "AUTH", role: "controller", token: record.controllerToken },
      1001,
    );
    room.remove("mobile");
    const restored = new ProbeSession(room.snapshot());
    restored.add("intruder", 1002);
    expect(
      restored.handle(
        "intruder",
        { type: "AUTH", role: "controller", token: record.controllerToken },
        1003,
      ).close,
    ).toBeDefined();
  });
  it("bounds peers, invitation time, session time and handshake time", () => {
    const { room, record } = setup();
    room.add("third", 1000);
    room.add("fourth", 1000);
    expect(room.add("fifth", 1000)).toBe(false);
    expect(
      room.handle("pc", { type: "AUTH", role: "host", token: record.hostToken }, 7000).close,
    ).toBeDefined();
    const fresh = new ProbeSession({ credentials: record, used: false, peers: [] });
    fresh.add("late", record.inviteUntil);
    expect(
      fresh.handle(
        "late",
        { type: "AUTH", role: "controller", token: record.controllerToken },
        record.inviteUntil,
      ).close,
    ).toBeDefined();
    expect(fresh.add("expired", record.expiresAt)).toBe(false);
  });
  it("rejects floods and untrusted payloads, including nonfinite/out-of-range controls", () => {
    const { room, record } = setup();
    room.handle("pc", { type: "AUTH", role: "host", token: record.hostToken }, 1001);
    for (let index = 0; index < 44; index++) room.handle("pc", { type: "STATS" }, 1002);
    expect(room.handle("pc", { type: "STATS" }, 1003).close).toBeDefined();
    for (const raw of [
      "null",
      "[]",
      "broken",
      '{"type":"INPUT","seq":0,"steer":2,"throttle":1,"brake":0}',
      '{"type":"SIGNAL","kind":"description","payload":"x","admin":true}',
    ]) {
      expect(parseProbeMessage(raw)).toBeUndefined();
    }
  });
});
