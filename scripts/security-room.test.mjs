import { afterEach, expect, it, vi } from "vitest";
import { createRoom } from "../packages/session-core/src/session.ts";
import { LEASE_MS } from "../packages/session-core/src/wire.ts";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
const { SessionRoom } = await import("../apps/relay-cloudflare/src/session-room.ts");
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { state } = await createRoom(now, now + LEASE_MS);
  state.host = "host";
  state.controller = { id: "phone", hash: "verifier" };
  state.linkedOnce = true;
  const data = new Map([["room", structuredClone(state)]]);
  let alarm = null;
  let serial = Promise.resolve();
  const peers = ["host", "phone"].map((id) => ({
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    deserializeAttachment: () => ({ id, authUntil: now + 5000, windowAt: now, count: 0 }),
    serializeAttachment: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  }));
  const storage = {
    get: async (key) => structuredClone(data.get(key)),
    put: vi.fn(async (key, value) => data.set(key, structuredClone(value))),
    deleteAll: vi.fn(async () => data.clear()),
    getAlarm: async () => alarm,
    setAlarm: async (value) => {
      alarm = value;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  };
  const quota = { reserve: vi.fn(async () => null), release: vi.fn(async () => {}) };
  const env = { SESSION_BUDGET: { getByName: () => quota } };
  const room = new SessionRoom(
    {
      storage,
      getWebSockets: () => peers,
      blockConcurrencyWhile(work) {
        const result = serial.then(work);
        serial = result.catch(() => {});
        return result;
      },
    },
    env,
  );
  await serial;
  storage.put.mockClear();
  return {
    room,
    state,
    env,
    quota,
    peers,
    storage,
    data,
    alarm: () => alarm,
    set: (value) => {
      now = value;
    },
  };
}

it.each(["denied", "unavailable"])(
  "ends and deletes restored rooms before an %s renewal can extend play",
  async (failure) => {
    const f = await fixture();
    if (failure === "unavailable")
      f.quota.reserve.mockRejectedValue(new Error("private quota detail"));
    f.set(f.state.leaseUntil - 30_000);
    await f.room.alarm();
    expect(f.quota.reserve).toHaveBeenCalledWith(f.state.id, f.state.leaseUntil);
    expect(f.quota.release).toHaveBeenCalledWith(f.state.id);
    expect(f.storage.deleteAll).toHaveBeenCalledTimes(1);
    expect(f.data.size).toBe(0);
    expect(f.alarm()).toBeNull();
    for (const socket of f.peers) {
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "ERROR", code: "QUOTA_EXHAUSTED" }),
      );
      expect(socket.close).toHaveBeenCalledWith(1008, "Session ended");
    }
  },
);
it("persists a successful lease renewal and retains the absolute expiry", async () => {
  const f = await fixture();
  f.set(f.state.leaseUntil - 30_000);
  f.quota.reserve.mockResolvedValue(f.state.leaseUntil + LEASE_MS);
  await f.room.alarm();
  const saved = f.data.get("room");
  expect(saved.leaseUntil).toBe(f.state.leaseUntil + LEASE_MS);
  expect(saved.hardUntil).toBe(f.state.hardUntil);
  expect(f.alarm()).toBe(saved.leaseUntil - 30_000);
});
it("does not persist frames, signals or raw sensor data and enforces the emergency stop", async () => {
  const f = await fixture();
  await f.room.webSocketMessage(
    f.peers[1],
    JSON.stringify({
      type: "INPUT",
      epoch: 0,
      seq: 1,
      captured: 1,
      input: { steer: 0.5, throttle: 1, brake: 0, boost: false, assist: false },
    }),
  );
  expect(f.storage.put).not.toHaveBeenCalled();
  expect(JSON.stringify([...f.data])).not.toMatch(/"steer"|"captured"|sdp|candidate/);
  f.env.SESSION_DISABLED = "true";
  await f.room.webSocketMessage(f.peers[1], JSON.stringify({ type: "HEARTBEAT", epoch: 0 }));
  expect(f.data.size).toBe(0);
  expect(f.quota.reserve).not.toHaveBeenCalled();
  expect(f.quota.release).toHaveBeenCalledWith(f.state.id);
  expect(f.peers[0].close).toHaveBeenCalled();
});
