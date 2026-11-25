import { type DriveFrame, parseDriveFrame, type TransportFrame } from "@qracer/session-core/wire";

type Signal = Extract<TransportFrame, { type: "SIGNAL" }>;
type Hooks = {
  signal: (kind: Signal["kind"], payload: string) => boolean;
  receive: (frame: DriveFrame) => void;
  ready: () => void;
  failed: () => void;
};

/** No discovery service or TURN is required. Failure always returns to the relay. */
export class DirectTransport {
  private pc?: RTCPeerConnection;
  private input?: RTCDataChannel;
  private actions?: RTCDataChannel;
  private timer = 0;
  private closed = false;
  private started = performance.now();
  private lastPong = this.started;
  private lastPing = 0;
  private probes = new Map<number, number>();
  private healthy = false;
  private peerHealthy = false;
  private announced = false;
  private candidates: RTCIceCandidateInit[] = [];
  private queue = Promise.resolve();
  private epoch = -1;
  private count = 0;
  private windowAt = this.started;
  private readonly encoder = new TextEncoder();
  private readonly packetBytes = new Uint8Array(1024);
  private receivedPause = -1;
  private pause?: {
    frame: Extract<DriveFrame, { type: "DRIVE_PAUSE" }>;
    sent: number;
    attempts: number;
  };
  private blockedAt?: number;
  readonly stats = { sent: 0, received: 0, bytes: 0, dropped: 0, rtt: [] as number[] };

  private host: boolean;
  private hooks: Hooks;
  constructor(host: boolean, hooks: Hooks) {
    this.host = host;
    this.hooks = hooks;
  }

  start() {
    if (this.pc || this.closed) return;
    try {
      this.pc = new RTCPeerConnection({ iceServers: [] });
      this.pc.onicecandidate = ({ candidate }) => {
        if (candidate) this.hooks.signal("candidate", JSON.stringify(candidate.toJSON()));
      };
      this.pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(this.pc?.connectionState ?? ""))
          this.fail();
      };
      this.pc.ondatachannel = ({ channel }) => this.bind(channel);
      if (this.host) {
        this.bind(this.pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 }));
        this.bind(this.pc.createDataChannel("actions", { ordered: true }));
        this.queue = this.offer().catch(() => this.fail());
      }
      this.timer = window.setInterval(() => this.tick(), 50);
    } catch {
      this.fail();
    }
  }

  private async offer() {
    const pc = this.pc;
    if (!pc) return;
    await pc.setLocalDescription(await pc.createOffer());
    if (!this.closed) this.hooks.signal("offer", JSON.stringify(pc.localDescription));
  }

  signal(frame: Signal) {
    this.queue = this.queue
      .then(async () => {
        const pc = this.pc;
        if (!pc || this.closed) return;
        const value = JSON.parse(frame.payload);
        if (frame.kind === "candidate") {
          if (pc.remoteDescription) await pc.addIceCandidate(value);
          else if (this.candidates.length < 32) this.candidates.push(value);
          else this.fail();
        } else {
          if (
            frame.kind !== (this.host ? "answer" : "offer") ||
            value.type !== frame.kind ||
            typeof value.sdp !== "string" ||
            pc.remoteDescription
          )
            return this.fail();
          await pc.setRemoteDescription(value);
          for (const candidate of this.candidates) await pc.addIceCandidate(candidate);
          this.candidates.length = 0;
          if (!this.host) {
            await pc.setLocalDescription(await pc.createAnswer());
            if (!this.closed) this.hooks.signal("answer", JSON.stringify(pc.localDescription));
          }
        }
      })
      .catch(() => this.fail());
  }

  configure(epoch: number) {
    if (this.epoch === epoch) return;
    this.epoch = epoch;
    this.receivedPause = -1;
    delete this.pause;
  }

  get ready() {
    return (
      !this.closed &&
      this.healthy &&
      this.peerHealthy &&
      this.input?.readyState === "open" &&
      this.actions?.readyState === "open"
    );
  }

  send(frame: DriveFrame) {
    if (!this.ready || frame.epoch !== this.epoch) return false;
    const channel = frame.type === "INPUT" ? this.input : this.actions;
    const sent = this.write(channel, JSON.stringify(frame));
    if (sent && frame.type === "DRIVE_PAUSE")
      this.pause = { frame, sent: performance.now(), attempts: 1 };
    return sent;
  }

  private write(channel: RTCDataChannel | undefined, raw: string) {
    if (channel?.readyState !== "open") return false;
    if (channel.bufferedAmount > 8192) {
      this.stats.dropped++;
      this.blockedAt ??= performance.now();
      if (performance.now() - this.blockedAt >= 250) this.fail();
      return false;
    }
    try {
      channel.send(raw);
      this.stats.sent++;
      this.stats.bytes += raw.length;
      return true;
    } catch {
      this.fail();
      return false;
    }
  }

  private bind(channel: RTCDataChannel) {
    if (
      channel.label === "input" &&
      !this.input &&
      !channel.ordered &&
      channel.maxRetransmits === 0
    )
      this.input = channel;
    else if (
      channel.label === "actions" &&
      !this.actions &&
      channel.ordered &&
      channel.maxRetransmits === null &&
      channel.maxPacketLifeTime === null
    )
      this.actions = channel;
    else {
      channel.close();
      return this.fail();
    }
    channel.onclose = channel.onerror = () => this.fail();
    channel.onmessage = ({ data }) => {
      if (
        this.closed ||
        typeof data !== "string" ||
        data.length > this.packetBytes.length ||
        this.encoder.encodeInto(data, this.packetBytes).read !== data.length
      )
        return this.fail();
      const now = performance.now();
      if (now - this.windowAt >= 1000) {
        this.count = 0;
        this.windowAt = now;
      }
      if (++this.count > 100) return this.fail();
      this.stats.received++;
      try {
        if (channel === this.actions && data === "healthy") {
          this.peerHealthy = true;
          this.announce();
          return;
        }
        if (channel === this.actions && /^[pr]:\d+$/.test(data)) {
          const id = Number(data.slice(2));
          if (data.startsWith("p:")) this.write(channel, `r:${id}`);
          else {
            const sent = this.probes.get(id);
            if (sent !== undefined) {
              this.probes.delete(id);
              this.lastPong = now;
              this.stats.rtt.push(now - sent);
              if (this.stats.rtt.length > 120) this.stats.rtt.shift();
              if (
                !this.healthy &&
                this.stats.rtt.length >= 3 &&
                this.input?.readyState === "open"
              ) {
                this.healthy = true;
                this.write(this.actions, "healthy");
                this.announce();
              }
            }
          }
          return;
        }
        const value = JSON.parse(data);
        if (
          channel === this.actions &&
          value.type === "PAUSE_ACK" &&
          value.epoch === this.epoch &&
          value.seq === this.pause?.frame.seq
        ) {
          delete this.pause;
          return;
        }
        const frame = parseDriveFrame(value);
        if (
          !frame ||
          frame.epoch !== this.epoch ||
          !this.ready ||
          (frame.type === "INPUT") !== (channel === this.input) ||
          (this.host ? ["DRIVE_STATE", "FEEDBACK"] : ["INPUT", "DRIVE_PAUSE"]).includes(frame.type)
        )
          return;
        if (frame.type === "DRIVE_PAUSE") {
          this.write(
            this.actions,
            JSON.stringify({ type: "PAUSE_ACK", epoch: frame.epoch, seq: frame.seq }),
          );
          if (frame.seq <= this.receivedPause) return;
          this.receivedPause = frame.seq;
        }
        this.hooks.receive(frame);
      } catch {
        this.fail();
      }
    };
  }

  private announce() {
    if (this.ready && !this.announced) {
      this.announced = true;
      this.hooks.ready();
    }
  }

  private tick() {
    const now = performance.now();
    if ((!this.healthy && now - this.started > 5000) || (this.healthy && now - this.lastPong > 250))
      return this.fail();
    if (this.blockedAt !== undefined) {
      if ((this.input?.bufferedAmount ?? 0) <= 8192 && (this.actions?.bufferedAmount ?? 0) <= 8192)
        delete this.blockedAt;
      else if (now - this.blockedAt >= 250) return this.fail();
    }
    if (this.actions?.readyState === "open" && now - this.lastPing >= 100) {
      this.lastPing = now;
      const id = Math.floor(now);
      this.probes.set(id, now);
      this.write(this.actions, `p:${id}`);
      for (const [key, sent] of this.probes) if (now - sent > 1000) this.probes.delete(key);
    }
    const pause = this.pause;
    if (pause && now - pause.sent > 100) {
      if (pause.attempts++ >= 3) return this.fail();
      pause.sent = now;
      this.write(this.actions, JSON.stringify(pause.frame));
    }
  }

  private fail() {
    if (!this.closed) {
      this.dispose();
      this.hooks.failed();
    }
  }

  dispose() {
    this.closed = true;
    clearInterval(this.timer);
    this.input?.close();
    this.actions?.close();
    this.pc?.close();
    this.probes.clear();
    this.candidates.length = 0;
    this.packetBytes.fill(0);
    delete this.pause;
  }
}
