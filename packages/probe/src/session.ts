import { equalToken, type Effect, type ProbeMessage } from "./messages.ts";

export { PROBE_MAX_BYTES, parseProbeMessage, equalToken } from "./messages.ts";
export type { ProbeMessage, Effect } from "./messages.ts";
export interface Credentials {
  id: string;
  hostToken: string;
  controllerToken: string;
  inviteUntil: number;
  expiresAt: number;
}
export interface Peer {
  id: string;
  openedAt: number;
  role?: "host" | "controller";
  seq: number;
  windowAt: number;
  rate: number;
  received: number;
  signalBytes?: number;
}
export interface Snapshot {
  credentials: Credentials;
  used: boolean;
  peers: Peer[];
}
export interface Outcome {
  send: Effect[];
  close?: string;
}

function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export function credentials(now: number): Credentials {
  return {
    id: crypto.randomUUID().replaceAll("-", ""),
    hostToken: secret(),
    controllerToken: secret(),
    inviteUntil: now + 120000,
    expiresAt: now + 20 * 60000,
  };
}

/** A bounded F02 experiment. Production pairing/reconnect policy remains in F04. */
export class ProbeSession {
  readonly credentials: Credentials;
  readonly peers = new Map<string, Peer>();
  used = false;
  constructor(snapshot: Snapshot) {
    this.credentials = snapshot.credentials;
    this.used = snapshot.used;
    for (const peer of snapshot.peers) this.peers.set(peer.id, { ...peer });
  }
  snapshot(): Snapshot {
    return {
      credentials: this.credentials,
      used: this.used,
      peers: [...this.peers.values()].map((peer) => ({ ...peer })),
    };
  }
  add(id: string, now: number): boolean {
    if (now >= this.credentials.expiresAt || this.peers.size >= 4 || this.peers.has(id))
      return false;
    this.peers.set(id, { id, openedAt: now, seq: -1, windowAt: now, rate: 0, received: 0 });
    return true;
  }
  remove(id: string): Effect[] {
    const role = this.peers.get(id)?.role;
    this.peers.delete(id);
    return role ? this.broadcast({ type: "PEER", connected: false }) : [];
  }
  private broadcast(body: Record<string, unknown>, except?: string): Effect[] {
    return [...this.peers.values()]
      .filter((peer) => peer.role && peer.id !== except)
      .map((peer) => ({ to: peer.id, body }));
  }
  handle(id: string, message: ProbeMessage, now: number): Outcome {
    const peer = this.peers.get(id);
    const reject = (close: string): Outcome => ({ close, send: [] });
    if (!peer || now >= this.credentials.expiresAt) return reject("Session expired");
    peer.received++;
    if (now - peer.windowAt >= 1000) {
      peer.windowAt = now;
      peer.rate = 0;
    }
    if (++peer.rate > 45) return reject("Rate exceeded");
    if (message.type === "AUTH") {
      if (peer.role || now - peer.openedAt > 5000) return reject("Invalid authentication state");
      const expected =
        message.role === "host" ? this.credentials.hostToken : this.credentials.controllerToken;
      if (!equalToken(message.token, expected)) return reject("Invalid credential");
      if ([...this.peers.values()].some((other) => other.role === message.role))
        return reject("Role already occupied");
      if (message.role === "controller" && (this.used || now >= this.credentials.inviteUntil))
        return reject("Invitation expired or consumed");
      peer.role = message.role;
      if (peer.role === "controller") this.used = true;
      const connected = [...this.peers.values()].filter((other) => other.role).length === 2;
      return {
        send: [
          ...this.broadcast({ type: "PEER", connected }),
          { to: id, body: { type: "READY", role: peer.role, connected } },
        ],
      };
    }
    if (!peer.role) return reject("Authenticate first");
    if (message.type === "SIGNAL") {
      peer.signalBytes = (peer.signalBytes ?? 0) + new TextEncoder().encode(message.payload).length;
      if (peer.signalBytes > 65536) return reject("Signaling budget exceeded");
    }
    if (message.type === "STATS") {
      return {
        send: [
          {
            to: id,
            body: {
              type: "STATS",
              received: [...this.peers.values()].reduce((sum, other) => sum + other.received, 0),
              expiresAt: this.credentials.expiresAt,
            },
          },
        ],
      };
    }
    if (message.type === "INPUT") {
      if (peer.role !== "controller") return reject("Controller input only");
      if (![...this.peers.values()].some((other) => other.role === "host"))
        return reject("Host unavailable");
      if (message.seq <= peer.seq) return { send: [] };
      peer.seq = message.seq;
    }
    return { send: this.broadcast(message, id) };
  }
}
