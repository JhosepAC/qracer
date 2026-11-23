import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createRoom, type Effect, randomId, RoomSession } from "@qracer/session-core";
import { MAX_PEERS, SESSION_BYTES } from "@qracer/session-core/wire";
import { WebSocket, WebSocketServer } from "ws";

const MAX_ROOMS = 8;

export function createSessions(origins: ReadonlySet<string>) {
  const rooms = new Map<string, RoomSession>();
  const peers = new Map<string, WebSocket>();
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: SESSION_BYTES,
    perMessageDeflate: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let provisioning = 0;
  let closing = false;

  function deliver(effects: Effect[]) {
    for (const { id, frame, close } of effects) {
      const socket = peers.get(id);
      if (socket?.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > 8192) {
        socket.terminate();
        continue;
      }
      socket.send(JSON.stringify(frame), (error) => {
        if (error) socket.terminate();
      });
      if (close) socket.close(1008, "Session ended");
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (closing) return;
    let deadline = Infinity;
    for (const [id, room] of rooms) {
      if (room.state.ended) rooms.delete(id);
      else deadline = Math.min(deadline, room.nextDeadline());
    }
    if (Number.isFinite(deadline)) {
      timer = setTimeout(
        () => {
          const now = Date.now();
          for (const room of rooms.values()) deliver(room.expire(now));
          schedule();
        },
        Math.max(1, deadline - Date.now()),
      );
      timer.unref();
    }
  }

  async function request(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.url !== "/session") return false;
    const origin = request.headers.origin ?? "";
    response.setHeader("Cache-Control", "no-store");
    if (!origins.has(origin)) {
      response.writeHead(403).end();
      return true;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Methods": "POST" }).end();
      return true;
    }
    const remote = request.socket.remoteAddress;
    const local =
      remote &&
      (remote === request.socket.localAddress ||
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote));
    if (!local) response.writeHead(403).end();
    else if (request.method !== "POST") response.writeHead(405, { Allow: "POST" }).end();
    else if (closing || rooms.size + provisioning >= MAX_ROOMS) {
      response
        .writeHead(429, { "Content-Type": "application/json", "Retry-After": "30" })
        .end(JSON.stringify({ type: "ERROR", code: "QUOTA_EXHAUSTED" }));
    } else {
      provisioning++;
      try {
        const { state, creation } = await createRoom(Date.now());
        if (closing || response.destroyed) response.end();
        else {
          rooms.set(state.id, new RoomSession(state));
          schedule();
          response
            .writeHead(201, { "Content-Type": "application/json" })
            .end(JSON.stringify(creation));
        }
      } catch {
        response.writeHead(503).end();
      } finally {
        provisioning--;
      }
    }
    return true;
  }

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!request.url?.startsWith("/session/ws/")) return false;
    const key = /^\/session\/ws\/([a-f0-9]{32})$/.exec(request.url)?.[1];
    const room = key ? rooms.get(key) : undefined;
    if (
      !room ||
      closing ||
      sockets.clients.size >= MAX_ROOMS * MAX_PEERS ||
      !origins.has(request.headers.origin ?? "") ||
      room.state.ended ||
      Date.now() >= room.until
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return true;
    }
    const id = randomId();
    sockets.handleUpgrade(request, socket, head, (peer) => {
      if (!room.accept(id, Date.now())) {
        peer.send(JSON.stringify({ type: "ERROR", code: "BUSY" }));
        return peer.close(1008, "Session unavailable");
      }
      peers.set(id, peer);
      schedule();
      peer.on("error", () => peer.terminate());
      peer.on("close", () => {
        peers.delete(id);
        deliver(room.remove(id, Date.now()));
        schedule();
      });
      peer.on("message", (data, binary) => {
        void room.receive(id, binary ? "" : data.toString()).then(
          (effects) => {
            deliver(effects);
            schedule();
          },
          () => peer.terminate(),
        );
      });
    });
    return true;
  }

  return {
    request,
    upgrade,
    async close() {
      closing = true;
      clearTimeout(timer);
      for (const peer of sockets.clients) peer.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      rooms.clear();
    },
  };
}
