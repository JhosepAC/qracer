import {
  AUTH_MS,
  type ClientFrame,
  type Creation,
  type ErrorCode,
  INVITE_MS,
  MAX_PEERS,
  parseClient,
  RECONNECT_MS,
  ROOM_MS,
  type ServerFrame,
  SESSION_VERSION,
} from "./wire.ts";

export interface Peer {
  id: string;
  authUntil: number;
  windowAt: number;
  count: number;
}

interface Pending {
  id: string;
  code: string;
  until: number;
}

export interface RoomState {
  id: string;
  hostHash: string;
  hardUntil: number;
  waitUntil: number;
  leaseUntil: number;
  linkedOnce: boolean;
  epoch: number;
  host?: string;
  hostAwayUntil?: number;
  invite?: { hash: string; until: number };
  pending?: Pending;
  controller?: { hash: string; id?: string; awayUntil?: number };
  ended?: ErrorCode;
}

export interface Effect {
  id: string;
  frame: ServerFrame;
  close?: true;
}

function hex(bytes: ArrayBufferView | ArrayBuffer): string {
  const data =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function randomId() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

async function hash(token: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

async function issue() {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await hash(token) };
}

function matches(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

export async function createRoom(
  now: number,
  lease = Infinity,
): Promise<{ state: RoomState; creation: Creation }> {
  const id = randomId();
  const host = await issue();
  return {
    state: {
      id,
      hostHash: host.hash,
      waitUntil: now + INVITE_MS,
      hardUntil: now + ROOM_MS,
      leaseUntil: Math.min(now + ROOM_MS, lease),
      linkedOnce: false,
      epoch: 0,
    },
    creation: { version: SESSION_VERSION, room: id, hostToken: host.token },
  };
}

export class RoomSession {
  readonly peers = new Map<string, Peer>();
  readonly state: RoomState;
  revision = 0;

  constructor(state: RoomState, peers: Iterable<Peer> = []) {
    this.state = state;
    for (const peer of peers) this.peers.set(peer.id, { ...peer });
  }

  get until(): number {
    const state = this.state;
    return Math.min(
      state.hardUntil,
      state.leaseUntil,
      state.hostAwayUntil ?? Infinity,
      state.linkedOnce && state.controller ? Infinity : state.waitUntil,
    );
  }

  nextDeadline(): number {
    if (this.state.ended) return Infinity;
    let until = Math.min(
      this.until,
      this.state.pending?.until ?? Infinity,
      this.state.invite?.until ?? Infinity,
      this.state.controller?.awayUntil ?? Infinity,
    );
    for (const peer of this.peers.values())
      if (!this.identified(peer.id)) until = Math.min(until, peer.authUntil);
    return until;
  }

  accept(id: string, now: number) {
    if (this.state.ended || now >= this.until || this.peers.size >= MAX_PEERS) return false;
    this.peers.set(id, { id, authUntil: now + AUTH_MS, windowAt: now, count: 0 });
    return true;
  }

  renew(until: number): boolean {
    if (this.state.ended || !this.state.controller || until <= this.state.leaseUntil) return false;
    this.state.leaseUntil = Math.min(until, this.state.hardUntil);
    this.revision++;
    return true;
  }

  private identified(id: string) {
    return (
      id === this.state.host || id === this.state.pending?.id || id === this.state.controller?.id
    );
  }

  private stateEffects(): Effect[] {
    const { pending, host, controller, epoch } = this.state;
    const until = this.until;
    const linked = Boolean(controller);
    const phase = controller ? (host && controller.id ? "connected" : "reconnecting") : "waiting";
    const effects: Effect[] = [];
    if (host)
      effects.push({
        id: host,
        frame: pending
          ? {
              type: "STATE",
              phase: "pending",
              request: pending.id,
              code: pending.code,
              epoch,
              until,
              linked,
            }
          : { type: "STATE", phase, epoch, until, linked },
      });
    if (pending)
      effects.push({
        id: pending.id,
        frame: { type: "STATE", phase: "pending", code: pending.code, epoch, until, linked: false },
      });
    if (controller?.id)
      effects.push({
        id: controller.id,
        frame: { type: "STATE", phase, epoch, until, linked: true },
      });
    return effects;
  }

  private reject(id: string, code: ErrorCode, close = true): Effect {
    return { id, frame: { type: "ERROR", code }, ...(close ? { close: true } : {}) };
  }

  private disconnectState(id: string, now: number) {
    const state = this.state;
    if (state.host === id) {
      delete state.host;
      state.hostAwayUntil = now + RECONNECT_MS;
    } else if (state.pending?.id === id) {
      delete state.pending;
    } else if (state.controller?.id === id) {
      delete state.controller.id;
      state.controller.awayUntil = now + RECONNECT_MS;
    } else return false;
    return true;
  }

  remove(id: string, now: number): Effect[] {
    this.peers.delete(id);
    if (this.state.ended || !this.disconnectState(id, now)) return [];
    this.revision++;
    return this.stateEffects();
  }

  reconcile(now: number) {
    const missing = [this.state.host, this.state.pending?.id, this.state.controller?.id];
    for (const id of missing) if (id && !this.peers.has(id)) this.remove(id, now);
  }

  private end(code: ErrorCode): Effect[] {
    this.state.ended = code;
    this.revision++;
    const effects = [...this.peers.keys()].map((id) => this.reject(id, code));
    this.peers.clear();
    return effects;
  }

  expire(now: number): Effect[] {
    const state = this.state;
    if (state.ended) return [];
    if (now >= this.until)
      return this.end(
        now >= state.leaseUntil && state.leaseUntil < state.hardUntil
          ? "QUOTA_EXHAUSTED"
          : "ROOM_EXPIRED",
      );
    const effects: Effect[] = [];
    let changed = false;
    if (state.invite && now >= state.invite.until) {
      delete state.invite;
      changed = true;
    }
    if (state.pending && now >= state.pending.until) {
      effects.push(this.reject(state.pending.id, "INVITE_EXPIRED"));
      this.peers.delete(state.pending.id);
      delete state.pending;
      changed = true;
    }
    if (state.controller?.awayUntil && now >= state.controller.awayUntil) {
      delete state.controller;
      state.epoch++;
      state.waitUntil = Math.min(state.hardUntil, now + INVITE_MS);
      changed = true;
    }
    for (const peer of this.peers.values()) {
      if (!this.identified(peer.id) && now >= peer.authUntil) {
        effects.push(this.reject(peer.id, "AUTH_REQUIRED"));
        this.peers.delete(peer.id);
      }
    }
    if (changed) {
      this.revision++;
      effects.push(...this.stateEffects());
    }
    return effects;
  }

  async receive(id: string, raw: string, now: () => number = Date.now): Promise<Effect[]> {
    const peer = this.peers.get(id);
    if (!peer) return [];
    const received = now();
    if (received - peer.windowAt >= 1000) {
      peer.windowAt = received;
      peer.count = 0;
    }
    const message = ++peer.count <= 8 ? parseClient(raw) : undefined;
    if (!message) return [this.reject(id, "INVALID"), ...this.remove(id, received)];
    if (!this.identified(id) && message.type !== "AUTH")
      return [this.reject(id, "AUTH_REQUIRED"), ...this.remove(id, received)];
    if (message.type === "AUTH" && message.version !== SESSION_VERSION)
      return [this.reject(id, "VERSION_MISMATCH"), ...this.remove(id, received)];
    const proof = message.type === "AUTH" ? await hash(message.token) : "";
    const fresh =
      (message.type === "AUTH" && message.role === "resume") ||
      (this.state.host === id && (message.type === "ROTATE" || message.type === "APPROVE"))
        ? await issue()
        : undefined;
    const time = now();
    const expired = this.expire(time);
    if (!this.peers.has(id)) return expired;
    const effects =
      message.type === "AUTH"
        ? this.authorize(id, message, proof, fresh, time)
        : this.hostAction(id, message, fresh, time);
    return expired.concat(effects);
  }

  private authorize(
    id: string,
    message: Extract<ClientFrame, { type: "AUTH" }>,
    proof: string,
    fresh: Awaited<ReturnType<typeof issue>> | undefined,
    now: number,
  ): Effect[] {
    const state = this.state;
    const failed = (code: ErrorCode) => [this.reject(id, code), ...this.remove(id, now)];
    if (this.identified(id)) return failed("INVALID");
    if (message.role === "host") {
      if (!matches(state.hostHash, proof)) return failed("UNAUTHORIZED");
      if (state.host) return failed("BUSY");
      if (state.hostAwayUntil) state.epoch++;
      state.host = id;
      delete state.hostAwayUntil;
    } else if (message.role === "invite") {
      if (!state.invite || !matches(state.invite.hash, proof)) return failed("INVITE_EXPIRED");
      if (!state.host || state.pending) return failed("BUSY");
      const sample = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
      state.pending = {
        id,
        code: String(sample % 1_000_000).padStart(6, "0"),
        until: state.invite.until,
      };
      delete state.invite;
    } else {
      const controller = state.controller;
      if (!controller || !fresh || !matches(controller.hash, proof)) return failed("UNAUTHORIZED");
      if (controller.id) return failed("BUSY");
      state.controller = { hash: fresh.hash, id };
      state.epoch++;
    }
    this.revision++;
    return [
      ...(message.role === "resume" && fresh
        ? [{ id, frame: { type: "RESUME", token: fresh.token } } as const]
        : []),
      ...this.stateEffects(),
    ];
  }

  private hostAction(
    id: string,
    message: Exclude<ClientFrame, { type: "AUTH" }>,
    fresh: Awaited<ReturnType<typeof issue>> | undefined,
    now: number,
  ): Effect[] {
    const state = this.state;
    if (state.host !== id) return [this.reject(id, "UNAUTHORIZED"), ...this.remove(id, now)];
    if (message.type === "END") return this.end("ROOM_EXPIRED");
    const effects: Effect[] = [];
    const pending = state.pending;
    if (message.type === "ROTATE" && fresh) {
      if (pending) {
        effects.push(this.reject(pending.id, "REVOKED"));
        this.peers.delete(pending.id);
        delete state.pending;
      }
      const until = Math.min(now + INVITE_MS, this.until);
      state.invite = { hash: fresh.hash, until };
      effects.push({ id, frame: { type: "INVITE", token: fresh.token, until } });
    } else if (message.type === "REVOKE") {
      const current = state.controller?.id;
      if (current) {
        effects.push(this.reject(current, "REVOKED"));
        this.peers.delete(current);
      }
      if (pending) {
        effects.push(this.reject(pending.id, "REVOKED"));
        this.peers.delete(pending.id);
      }
      delete state.invite;
      delete state.pending;
      delete state.controller;
      state.epoch++;
      state.waitUntil = Math.min(state.hardUntil, now + INVITE_MS);
    } else if (
      (message.type === "APPROVE" || message.type === "REJECT") &&
      pending?.id === message.request
    ) {
      delete state.pending;
      if (message.type === "APPROVE" && fresh) {
        const old = state.controller?.id;
        if (old) {
          effects.push(this.reject(old, "REVOKED"));
          this.peers.delete(old);
        }
        state.controller = { hash: fresh.hash, id: pending.id };
        state.linkedOnce = true;
        state.epoch++;
        effects.push({ id: pending.id, frame: { type: "RESUME", token: fresh.token } });
      } else {
        effects.push(this.reject(pending.id, "REVOKED"));
        this.peers.delete(pending.id);
      }
    } else return [this.reject(id, "INVALID", false)];
    this.revision++;
    effects.push(...this.stateEffects());
    return effects;
  }
}
