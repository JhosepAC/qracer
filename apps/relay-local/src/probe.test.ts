import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Credentials } from "@qracer/probe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelay } from "./server.ts";

describe("F02 local probe", () => {
  const origin = "http://trusted.local";
  const key = "a".repeat(64);
  let relay: ReturnType<typeof createRelay>;
  let url: string;
  const create = () =>
    fetch(`${url}/probe/session`, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${key}` },
    });
  const read = async (peer: WebSocket) => JSON.parse(String((await once(peer, "message"))[0]));
  async function connect(keys: Credentials, role: "host" | "controller") {
    const peer = new WebSocket(`${url.replace("http", "ws")}/probe/ws/${keys.id}`, { origin });
    await once(peer, "open");
    peer.send(JSON.stringify({ type: "AUTH", role, token: keys[`${role}Token`] }));
    await read(peer); // PEER comes before READY.
    return peer;
  }
  beforeEach(async () => {
    relay = createRelay({ allowedOrigins: [origin], probeKey: key });
    relay.server.listen(0, "127.0.0.1");
    await once(relay.server, "listening");
    url = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => relay.close());

  it("protects creation with exact Origin and capability, and caps live rooms", async () => {
    expect((await fetch(`${url}/probe/session`, { method: "POST" })).status).toBe(403);
    expect(
      (await fetch(`${url}/probe/session`, { method: "POST", headers: { Origin: origin } })).status,
    ).toBe(403);
    for (let i = 0; i < 8; i++) expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(429);
  });

  it("delivers controller input to its host and consumes the invitation", async () => {
    const keys = (await (await create()).json()) as Credentials;
    const host = await connect(keys, "host");
    const controller = await connect(keys, "controller");
    const input = { type: "INPUT", seq: 1, steer: 0.5, throttle: 1, brake: 0 };
    const received = read(host);
    controller.send(JSON.stringify(input));
    expect(await received).toEqual(input);
    const disconnected = read(host);
    controller.close();
    await once(controller, "close");
    expect(await disconnected).toEqual({ type: "PEER", connected: false });
    const intruder = new WebSocket(`${url.replace("http", "ws")}/probe/ws/${keys.id}`, { origin });
    await once(intruder, "open");
    intruder.send(
      JSON.stringify({ type: "AUTH", role: "controller", token: keys.controllerToken }),
    );
    expect((await once(intruder, "close"))[0]).toBe(1008);
  });

  it("closes oversized data and rejects sockets for unknown rooms", async () => {
    const keys = (await (await create()).json()) as Credentials;
    const peer = await connect(keys, "host");
    peer.send("x".repeat(16385));
    expect((await once(peer, "close"))[0]).toBe(1009);
    const unknown = new WebSocket(`${url.replace("http", "ws")}/probe/ws/${"0".repeat(32)}`, {
      origin,
    });
    expect(String((await once(unknown, "error"))[0])).toContain("403");
  });
});
