import { DurableObject } from "cloudflare:workers";
import {
  type Credentials,
  credentials,
  type Effect,
  type Peer,
  parseProbeMessage,
  ProbeSession,
} from "@qracer/probe";

export interface ProbeEnv {
  PROBES?: DurableObjectNamespace<ProbeRoom>;
  PROBE_KEY?: string;
  PROBE_ORIGINS?: string;
}

/** F02 only: SQLite metadata + socket attachments, no per-input database writes/timers. */
export class ProbeRoom extends DurableObject<ProbeEnv> {
  private readonly bootId = crypto.randomUUID();
  private session: ProbeSession | undefined;
  private sockets = new Map<string, WebSocket>();
  constructor(ctx: DurableObjectState, env: ProbeEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const keys = await ctx.storage.get<Credentials>("credentials");
      if (!keys) return;
      const peers: Peer[] = [];
      for (const socket of ctx.getWebSockets()) {
        const peer = socket.deserializeAttachment() as Peer;
        if (socket.readyState !== WebSocket.OPEN) continue;
        peers.push(peer);
        this.sockets.set(peer.id, socket);
      }
      this.session = new ProbeSession({
        credentials: keys,
        used: (await ctx.storage.get<boolean>("used")) ?? false,
        peers,
      });
    });
  }
  async initialize(keys: Credentials) {
    if (this.session) throw new Error("Already initialized");
    this.session = new ProbeSession({ credentials: keys, used: false, peers: [] });
    await this.ctx.storage.put("credentials", keys);
    await this.ctx.storage.setAlarm(keys.expiresAt);
  }
  /** One coordinator, invoked only after Worker capability authentication. */
  async createExperiment(): Promise<Credentials | null> {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, expires INTEGER)");
    sql.exec("CREATE TABLE IF NOT EXISTS daily (day INTEGER PRIMARY KEY, count INTEGER)");
    const keys = credentials(Date.now());
    const admitted = this.ctx.storage.transactionSync(() => {
      const day = Math.floor(Date.now() / 86400000);
      sql.exec("DELETE FROM daily WHERE day != ?", day);
      sql.exec("INSERT OR IGNORE INTO daily VALUES (?, 0)", day);
      if (
        sql.exec<{ count: number }>("SELECT count FROM daily WHERE day = ?", day).one().count >= 8
      )
        return false;
      sql.exec("DELETE FROM slots WHERE expires <= ?", Date.now());
      if (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM slots").one().n >= 8) return false;
      sql.exec("INSERT INTO slots VALUES (?, ?)", keys.id, keys.expiresAt);
      sql.exec("UPDATE daily SET count = count + 1 WHERE day = ?", day);
      return true;
    });
    if (!admitted || !this.env.PROBES) return null;
    await this.ctx.storage.setAlarm(keys.expiresAt);
    await this.env.PROBES.getByName(keys.id).initialize(keys);
    return keys;
  }
  private deliver(effects: Effect[]) {
    for (const effect of effects) {
      const socket = this.sockets.get(effect.to);
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          if (socket.bufferedAmount > 16384) socket.close(1008, "Slow consumer");
          else socket.send(JSON.stringify(effect.body));
        } catch {
          socket.close(1011, "Transport unavailable");
        }
      }
    }
  }
  private async schedule() {
    if (!this.session) return;
    let deadline = this.session.credentials.expiresAt;
    for (const peer of this.session.peers.values()) {
      if (!peer.role) deadline = Math.min(deadline, peer.openedAt + 5001);
    }
    await this.ctx.storage.setAlarm(deadline);
  }
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    const id = crypto.randomUUID();
    if (!this.session?.add(id, Date.now())) return new Response("Unavailable", { status: 403 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(this.session.peers.get(id));
    this.sockets.set(id, pair[1]);
    await this.schedule();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const peer = socket.deserializeAttachment() as Peer;
    const message = typeof raw === "string" ? parseProbeMessage(raw) : undefined;
    if (!message || !this.session) return socket.close(1008, "Invalid message");
    const wasUsed = this.session.used;
    const result = this.session.handle(peer.id, message, Date.now());
    for (const effect of result.send)
      if (effect.body.type === "STATS") effect.body.bootId = this.bootId;
    socket.serializeAttachment(this.session.peers.get(peer.id));
    if (!wasUsed && this.session.used) await this.ctx.storage.put("used", true);
    this.deliver(result.send);
    if (result.close) socket.close(1008, result.close);
    if (message.type === "AUTH") await this.schedule();
  }
  override webSocketClose(socket: WebSocket) {
    const peer = socket.deserializeAttachment() as Peer;
    this.sockets.delete(peer.id);
    this.deliver(this.session?.remove(peer.id) ?? []);
    socket.close();
  }
  override webSocketError(socket: WebSocket) {
    socket.close(1011, "Transport error");
  }
  override async alarm() {
    if (!this.session) {
      // Coordinator rows are reservations, not a permanent session log.
      this.ctx.storage.sql.exec("DELETE FROM slots WHERE expires <= ?", Date.now());
      return;
    }
    const expired = Date.now() >= this.session.credentials.expiresAt;
    for (const peer of this.session.peers.values()) {
      if (expired || (!peer.role && Date.now() - peer.openedAt > 5000)) {
        this.sockets.get(peer.id)?.close(1008, expired ? "Session expired" : "AUTH required");
        this.sockets.delete(peer.id);
        this.deliver(this.session.remove(peer.id));
      }
    }
    if (expired) {
      this.session = undefined;
      await this.ctx.storage.deleteAll();
    } else await this.schedule();
  }
}
