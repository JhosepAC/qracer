import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import {
  credentials,
  equalToken,
  type Effect,
  parseProbeMessage,
  PROBE_MAX_BYTES,
  ProbeSession,
} from "@qracer/probe";
import { WebSocket, WebSocketServer } from "ws";

/** Isolated, short-lived F02 experiments; never a public room directory. */
export function createProbe(origins: Set<string>, creationKey?: string) {
  if (creationKey && !/^[a-f0-9]{64}$/.test(creationKey)) throw new Error("Invalid probe key");
  const rooms = new Map<string, ProbeSession>();
  const peers = new Map<string, WebSocket>();
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: PROBE_MAX_BYTES,
    perMessageDeflate: false,
  });
  function deliver(effects: Effect[]) {
    for (const effect of effects) {
      const peer = peers.get(effect.to);
      if (peer?.readyState !== WebSocket.OPEN) continue;
      if (peer.bufferedAmount > PROBE_MAX_BYTES) peer.close(1008, "Slow consumer");
      else peer.send(JSON.stringify(effect.body));
    }
  }
  const sweep = setInterval(() => {
    for (const [id, room] of rooms) {
      if (Date.now() < room.credentials.expiresAt) continue;
      for (const peer of room.peers.values()) peers.get(peer.id)?.close(1008, "Session expired");
      rooms.delete(id);
    }
  }, 1000);
  sweep.unref();
  return {
    request(request: IncomingMessage, response: ServerResponse): boolean {
      if (request.url !== "/probe/session") return false;
      response.setHeader("Cache-Control", "no-store");
      const origin = request.headers.origin ?? "";
      if (!origins.has(origin)) {
        response.writeHead(403).end();
        return true;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      if (request.method === "OPTIONS") {
        response
          .writeHead(204, {
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Authorization",
          })
          .end();
        return true;
      }
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        request.socket.remoteAddress ?? "",
      );
      const localCaller =
        loopback ||
        Boolean(
          request.socket.remoteAddress &&
            request.socket.remoteAddress === request.socket.localAddress,
        );
      const authorized = creationKey
        ? equalToken(request.headers.authorization?.replace(/^Bearer /, "") ?? "", creationKey)
        : localCaller;
      if (!authorized) response.writeHead(403).end();
      else if (request.method !== "POST") response.writeHead(405, { Allow: "POST" }).end();
      else if (rooms.size >= 8) response.writeHead(429, { "Retry-After": "60" }).end();
      else {
        const keys = credentials(Date.now());
        rooms.set(keys.id, new ProbeSession({ credentials: keys, used: false, peers: [] }));
        response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify(keys));
      }
      return true;
    },
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if (!request.url?.startsWith("/probe/ws/")) return false;
      const id = /^\/probe\/ws\/([a-f0-9]{32})$/.exec(request.url)?.[1];
      const room = id ? rooms.get(id) : undefined;
      const peerId = crypto.randomUUID();
      if (
        !room ||
        !origins.has(request.headers.origin ?? "") ||
        room.peers.size >= 4 ||
        Date.now() >= room.credentials.expiresAt
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return true;
      }
      sockets.handleUpgrade(request, socket, head, (peer) => {
        if (!room.add(peerId, Date.now())) return peer.close(1008, "Session unavailable");
        peers.set(peerId, peer);
        const deadline = setTimeout(() => peer.close(1008, "AUTH required"), 5000);
        deadline.unref();
        peer.on("error", () => peer.terminate());
        peer.on("close", () => {
          clearTimeout(deadline);
          peers.delete(peerId);
          deliver(room.remove(peerId));
        });
        peer.on("message", (raw, binary) => {
          const message = binary ? undefined : parseProbeMessage(raw.toString());
          if (!message) return peer.close(1008, "Invalid message");
          const result = room.handle(peerId, message, Date.now());
          deliver(result.send);
          if (result.close) peer.close(1008, result.close);
          if (room.peers.get(peerId)?.role) clearTimeout(deadline);
        });
      });
      return true;
    },
    async close() {
      clearInterval(sweep);
      for (const peer of sockets.clients) peer.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      rooms.clear();
    },
  };
}
