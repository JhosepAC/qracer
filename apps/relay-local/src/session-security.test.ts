import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { SESSION_BYTES } from "@qracer/session-core/wire";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelay } from "./server.ts";

const origin = "https://game.example";
let relay: ReturnType<typeof createRelay>;
let base: string;
beforeEach(async () => {
  relay = createRelay({ allowedOrigins: [origin] });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  base = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
});
afterEach(async () => relay.close());
async function create() {
  const response = await fetch(`${base}/session`, { method: "POST", headers: { Origin: origin } });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ room: string; hostToken: string }>;
}
async function connect(room: string) {
  const peer = new WebSocket(`${base.replace(/^http/, "ws")}/session/ws/${room}`, { origin });
  peer.on("error", () => {});
  await once(peer, "open");
  return peer;
}
it("rejects missing, opaque and suffix origins for creation and WebSocket upgrades", async () => {
  const { room } = await create();
  for (const hostile of ["", "null", `${origin}.evil`]) {
    const response = await fetch(`${base}/session`, {
      method: "POST",
      headers: { Origin: hostile },
    });
    expect(response.status).toBe(403);
    const peer = new WebSocket(`${base.replace(/^http/, "ws")}/session/ws/${room}`, {
      origin: hostile,
    });
    await expect(once(peer, "open")).rejects.toThrow("403");
  }
});
it("requires authentication after a valid-origin upgrade and never treats the ID as a capability", async () => {
  const { room } = await create();
  const peer = await connect(room);
  const error = once(peer, "message");
  const ended = once(peer, "close");
  peer.send(JSON.stringify({ type: "END" }));
  expect(JSON.parse(String((await error)[0]))).toEqual({ type: "ERROR", code: "AUTH_REQUIRED" });
  expect((await ended)[0]).toBe(1008);
});
it.each(["binary", "oversized"])("closes %s frames before parsing their contents", async (kind) => {
  const peer = await connect((await create()).room);
  const ended = once(peer, "close");
  peer.send(kind === "binary" ? Buffer.from("{}") : "x".repeat(SESSION_BYTES + 1));
  expect((await ended)[0]).toBe(kind === "binary" ? 1008 : 1009);
});
it("expires unauthenticated upgraded sockets without receiving any payload", async () => {
  const peer = await connect((await create()).room);
  expect((await once(peer, "close"))[0]).toBe(1008);
});
it("closes an authenticated message flood while preserving strict role authentication", async () => {
  const { room, hostToken } = await create();
  const peer = await connect(room);
  const ready = once(peer, "message");
  peer.send(JSON.stringify({ type: "AUTH", version: 3, role: "host", token: hostToken }));
  expect(JSON.parse(String((await ready)[0])).type).toBe("STATE");
  const ended = once(peer, "close");
  for (let i = 0; i < 60; i++) peer.send(JSON.stringify({ type: "HEARTBEAT", epoch: 0 }));
  expect((await ended)[0]).toBe(1008);
});
