import { afterEach, expect, it, vi } from "vitest";
import { DirectTransport } from "./direct.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const channels: Record<
    string,
    {
      label: string;
      ordered: boolean;
      maxRetransmits: number | null;
      maxPacketLifeTime: null;
      readyState: string;
      bufferedAmount: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      onmessage?: (event: { data: string }) => void;
    }
  > = {};
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      localDescription = { type: "offer", sdp: "test" };
      createDataChannel(label: string, options: { ordered: boolean; maxRetransmits?: number }) {
        const channel = {
          label,
          ordered: options.ordered,
          maxRetransmits: options.maxRetransmits ?? null,
          maxPacketLifeTime: null,
          readyState: "open",
          bufferedAmount: 0,
          send: vi.fn(),
          close: vi.fn(),
        };
        channels[label] = channel;
        return channel;
      }
      async createOffer() {
        return this.localDescription;
      }
      async setLocalDescription() {}
      close() {}
    },
  );
  const hooks = { signal: vi.fn(() => true), receive: vi.fn(), ready: vi.fn(), failed: vi.fn() };
  const direct = new DirectTransport(true, hooks);
  direct.configure(7);
  direct.start();
  const actions = channels.actions;
  const input = channels.input;
  if (!actions || !input) throw new Error("Missing RTC channels");
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(100);
    const ping = actions.send.mock.calls
      .map(([raw]) => String(raw))
      .filter((raw) => raw.startsWith("p:"))
      .at(-1);
    if (!ping) throw new Error("Missing health probe");
    actions.onmessage?.({ data: ping.replace("p:", "r:") });
  }
  actions.onmessage?.({ data: "healthy" });
  expect(direct.ready).toBe(true);
  expect(hooks.ready).toHaveBeenCalledTimes(1);
  return { direct, hooks, channels, actions, input };
}

it("drops saturated snapshots and closes the direct route within the recovery deadline", async () => {
  const { direct, input, hooks } = await setup();
  input.bufferedAmount = 8193;
  const snapshot = {
    type: "INPUT",
    epoch: 7,
    seq: 1,
    captured: 1,
    input: { steer: 0, throttle: 1, brake: 0, boost: false, assist: false },
  } as const;
  expect(direct.send(snapshot)).toBe(false);
  expect(input.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(hooks.failed).toHaveBeenCalledTimes(1);
  expect(direct.ready).toBe(false);
});

it("rejects old epochs and wrong channels and acknowledges a pause exactly once", async () => {
  const { direct, input, actions, hooks } = await setup();
  const deliver = (frame: unknown) => actions.onmessage?.({ data: JSON.stringify(frame) });
  deliver({ type: "DRIVE_PAUSE", epoch: 6, seq: 1 });
  deliver({ type: "DRIVE_STATE", epoch: 7, mode: "racing", speed: 80, integrity: 3, nitro: 1 });
  deliver({
    type: "INPUT",
    epoch: 7,
    seq: 1,
    captured: 1,
    input: { steer: 0, throttle: 1, brake: 0, boost: false, assist: false },
  });
  expect(hooks.receive).not.toHaveBeenCalled();
  deliver({ type: "DRIVE_PAUSE", epoch: 7, seq: 2 });
  deliver({ type: "DRIVE_PAUSE", epoch: 7, seq: 2 });
  expect(hooks.receive).toHaveBeenCalledTimes(1);
  expect(
    actions.send.mock.calls.filter(
      ([raw]) => JSON.parse(String(raw).startsWith("{") ? String(raw) : "{}").type === "PAUSE_ACK",
    ),
  ).toHaveLength(2);
  direct.configure(8);
  input.onmessage?.({
    data: JSON.stringify({ type: "INPUT", epoch: 7, seq: 99, captured: 1 }),
  });
  expect(hooks.receive).toHaveBeenCalledTimes(1);
  direct.dispose();
});

it("ends negotiation at five seconds without requiring an external ICE service", async () => {
  const { direct, hooks } = await setup();
  direct.dispose();
  const unresponsive = new DirectTransport(true, hooks);
  unresponsive.start();
  await vi.advanceTimersByTimeAsync(5050);
  expect(hooks.failed).toHaveBeenCalledTimes(1);
  expect(unresponsive.ready).toBe(false);
});
