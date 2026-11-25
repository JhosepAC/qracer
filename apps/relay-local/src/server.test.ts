import { once } from "node:events";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const response = await fetch(`${url}/health`);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Permissions-Policy")).toContain("microphone=()");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await response.json()).toEqual({
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

  it("bounds websocket messages before JSON parsing", async () => {
    const peer = new WebSocket(`${url.replace("http", "ws")}/ws`, {
      origin: "http://trusted.local",
    });
    await once(peer, "open");
    peer.send(" ".repeat(1025));
    const [code] = await once(peer, "close");
    expect(code).toBe(1009);
  });

  it("rejects binary input instead of interpreting it as a control message", async () => {
    const peer = new WebSocket(`${url.replace("http", "ws")}/ws`, {
      origin: "http://trusted.local",
    });
    await once(peer, "open");
    peer.send(Buffer.from('{"type":"HELLO","version":1,"role":"host"}'));
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

it("fails closed with security headers if built relay configuration is malformed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qracer-policy-"));
  try {
    await writeFile(join(dir, "security-origins.json"), '["https://secret@relay.example"]');
    const broken = createRelay({ staticDir: dir, allowedOrigins: [] });
    try {
      broken.server.listen(0, "127.0.0.1");
      await once(broken.server, "listening");
      const response = await fetch(
        `http://127.0.0.1:${(broken.server.address() as AddressInfo).port}/health`,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
      expect(await response.text()).not.toContain("secret");
    } finally {
      await broken.close();
    }
  } finally {
    await rm(join(dir, "security-origins.json"), { force: true });
    await rmdir(dir);
  }
});
