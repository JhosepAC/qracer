import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelay } from "./server.ts";

describe("local bootstrap relay", () => {
  let relay: ReturnType<typeof createRelay>;
  let url: string;
  beforeEach(async () => {
    relay = createRelay({ allowedOrigins: ["http://trusted.local"] });
    relay.server.listen(0, "127.0.0.1");
    await once(relay.server, "listening");
    url = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => relay.close());

  it("serves versioned health and rejects unsupported HTTP methods", async () => {
    expect(await (await fetch(`${url}/health`)).json()).toEqual({
      status: "ok",
      protocolVersion: 1,
    });
    expect((await fetch(`${url}/health`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${url}/.env`)).status).toBe(404);
  });

  it("rejects an untrusted websocket origin", async () => {
    const peer = new WebSocket(`${url.replace("http", "ws")}/ws`, {
      origin: "http://untrusted.local",
    });
    const [error] = await once(peer, "error");
    expect(String(error)).toContain("403");
  });

  it("requires HELLO before PING and closes invalid input", async () => {
    const peer = new WebSocket(`${url.replace("http", "ws")}/ws`, {
      origin: "http://trusted.local",
    });
    await once(peer, "open");
    peer.send('{"type":"PING","id":1}');
    const [code] = await once(peer, "close");
    expect(code).toBe(1008);
  });

  it("accepts a supported handshake then returns the ping ID", async () => {
    const peer = new WebSocket(`${url.replace("http", "ws")}/ws`, {
      origin: "http://trusted.local",
    });
    await once(peer, "open");
    peer.send('{"type":"HELLO","version":1,"role":"host"}');
    expect(JSON.parse(String((await once(peer, "message"))[0]))).toEqual({
      type: "WELCOME",
      protocolVersion: 1,
    });
    peer.send('{"type":"PING","id":42}');
    expect(JSON.parse(String((await once(peer, "message"))[0]))).toEqual({ type: "PONG", id: 42 });
    peer.close();
    await once(peer, "close");
  });
});
