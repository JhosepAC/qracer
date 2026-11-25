import { DurableObject } from "cloudflare:workers";
import {
  type Effect,
  type Peer,
  RoomSession,
  type RoomState,
  randomId,
} from "@qracer/session-core";
import { SESSION_BYTES } from "@qracer/session-core/wire";
import type { SessionBudget } from "./session-budget.ts";

export interface SessionEnv {
  SESSIONS?: DurableObjectNamespace<SessionRoom>;
  SESSION_BUDGET?: DurableObjectNamespace<SessionBudget>;
  SESSION_ORIGINS?: string;
  SESSION_KEY?: string;
  SESSION_DISABLED?: string;
  LOCAL_DIAGNOSTICS?: string;
}

export function budget(env: SessionEnv) {
  if (!env.SESSION_BUDGET) throw new Error("Session budget is unavailable");
  return env.SESSION_BUDGET.getByName("qracer-session-v1");
}

const RENEW_NOTICE = 30_000;

export class SessionRoom extends DurableObject<SessionEnv> {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly boot = randomId();
  private room?: RoomSession;
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: SessionEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get<RoomState>("room");
      if (!state) return;
      this.alarmAt = await ctx.storage.getAlarm();
      const peers: Peer[] = [];
      for (const socket of ctx.getWebSockets()) {
        const peer = socket.deserializeAttachment() as Peer | undefined;
        if (!peer || socket.readyState !== WebSocket.OPEN) continue;
        peers.push(peer);
        this.sockets.set(peer.id, socket);
      }
      const room = new RoomSession(state, peers);
      this.room = room;
      room.reconcile(Date.now());
      await this.flush(
        room,
        this.env.SESSION_DISABLED === "true" ? room.stopAtQuota() : room.expire(Date.now()),
        0,
      );
    });
  }

  async initialize(state: RoomState) {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.room) throw new Error("Room already exists");
      this.room = new RoomSession(state);
      await this.ctx.storage.put("room", state);
      await this.schedule(this.room);
    });
  }

  private canRenew(room: RoomSession) {
    const { host, controller, leaseUntil, hardUntil } = room.state;
    return host && controller?.id && leaseUntil < hardUntil;
  }

  private async schedule(room: RoomSession) {
    let when = room.nextDeadline();
    if (this.canRenew(room)) when = Math.min(when, room.state.leaseUntil - RENEW_NOTICE);
    if (when !== this.alarmAt && Number.isFinite(when)) {
      this.alarmAt = when;
      await this.ctx.storage.setAlarm(Math.max(Date.now(), when));
    }
  }

  private deliver(effects: Effect[]) {
    for (const { id, frame, close } of effects) {
      const socket = this.sockets.get(id);
      if (socket?.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > 8192) {
        socket.close(1008, "Slow consumer");
        continue;
      }
      const data =
        this.env.LOCAL_DIAGNOSTICS === "true" && frame.type === "STATE"
          ? { ...frame, boot: this.boot }
          : frame;
      socket.send(JSON.stringify(data));
      if (close) socket.close(1008, "Session ended");
    }
  }

  private async flush(room: RoomSession, effects: Effect[], revision: number) {
    if (room.state.ended) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.alarmAt = null;
      delete this.room;
      this.deliver(effects);
      this.sockets.clear();
      try {
        await budget(this.env).release(room.state.id);
      } catch {
        // The reservation has its own expiry.
      }
    } else {
      if (room.revision !== revision) await this.ctx.storage.put("room", room.state);
      await this.schedule(room);
      this.deliver(effects);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    return this.ctx.blockConcurrencyWhile(async () => {
      const room = this.room;
      const id = randomId();
      if (!room || Date.now() >= room.until) return new Response("Unavailable", { status: 403 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      if (!room.accept(id, Date.now())) {
        pair[1].send(JSON.stringify({ type: "ERROR", code: "BUSY" }));
        pair[1].close(1008, "Session unavailable");
      } else {
        pair[1].serializeAttachment(room.peers.get(id));
        this.sockets.set(id, pair[1]);
        await this.schedule(room);
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const peer = socket.deserializeAttachment() as Peer | undefined;
      const room = this.room;
      if (!room || !peer) return socket.close(1008, "Session unavailable");
      const revision = room.revision;
      if (this.env.SESSION_DISABLED === "true") {
        await this.flush(room, room.stopAtQuota(), revision);
        return;
      }
      const text =
        typeof raw === "string" &&
        raw.length <= SESSION_BYTES &&
        new TextEncoder().encode(raw).length <= SESSION_BYTES
          ? raw
          : "";
      const effects = await room.receive(peer.id, text);
      const current = room.peers.get(peer.id);
      if (current) socket.serializeAttachment(current);
      await this.flush(room, effects, revision);
    });
  }

  override async webSocketClose(socket: WebSocket) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const peer = socket.deserializeAttachment() as Peer | undefined;
      const room = this.room;
      if (room && peer) {
        const revision = room.revision;
        this.sockets.delete(peer.id);
        await this.flush(room, room.remove(peer.id, Date.now()), revision);
      }
      socket.close();
    });
  }

  override webSocketError(socket: WebSocket) {
    socket.close(1011, "Transport error");
  }

  override async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.alarmAt = null;
      const room = this.room;
      if (!room) return;
      const now = Date.now();
      const revision = room.revision;
      const effects = this.env.SESSION_DISABLED === "true" ? room.stopAtQuota() : room.expire(now);
      if (!room.state.ended && this.canRenew(room) && now >= room.state.leaseUntil - RENEW_NOTICE) {
        try {
          const until = await budget(this.env).reserve(room.state.id, room.state.leaseUntil);
          effects.push(...(until ? room.renew(until) : room.stopAtQuota()));
        } catch {
          effects.push(...room.stopAtQuota());
        }
      }
      await this.flush(room, effects, revision);
    });
  }
}
