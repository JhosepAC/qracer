import type { Frame, ProbeLink } from "./link.ts";

/** Connectivity/RTT experiment only. Controls continue over WSS throughout F02. */
export class RtcProbe {
  private pc: RTCPeerConnection | undefined;
  private channel: RTCDataChannel | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private candidates: RTCIceCandidateInit[] = [];
  private queue: Promise<void> = Promise.resolve();
  private sent = new Map<number, number>();
  private id = 0;
  private closed = false;
  readonly report = {
    state: "sin probar",
    samples: [] as number[],
    candidateTypes: [] as string[],
  };
  private link: ProbeLink;
  private host: boolean;
  private status: (message: string) => void;
  constructor(link: ProbeLink, host: boolean, status: (message: string) => void) {
    this.link = link;
    this.host = host;
    this.status = status;
  }
  async start() {
    try {
      await this.open();
    } catch {
      this.finish("Negociación no disponible; WSS continúa");
    }
  }
  private async open() {
    if (this.pc || this.closed) return;
    if (!("RTCPeerConnection" in window)) return this.finish("WebRTC no disponible; WSS continúa");
    this.report.state = "negociando";
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      if (candidate.type && !this.report.candidateTypes.includes(candidate.type))
        this.report.candidateTypes.push(candidate.type);
      this.signal("candidate", candidate.toJSON());
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "failed" || this.pc?.connectionState === "disconnected")
        this.finish("ICE sin ruta; WSS continúa");
    };
    this.timeout = setTimeout(() => this.finish("ICE agotó 5 s; WSS continúa"), 5000);
    if (this.host) {
      this.bind(this.pc.createDataChannel("f02-echo", { ordered: false, maxRetransmits: 0 }));
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.signal("description", this.pc.localDescription);
    } else this.pc.ondatachannel = ({ channel }) => this.bind(channel);
  }
  receive(frame: Frame) {
    this.queue = this.queue
      .then(async () => {
        if (
          this.closed ||
          frame.type !== "SIGNAL" ||
          typeof frame.payload !== "string" ||
          frame.payload.length > 12000
        )
          return;
        await this.start();
        if (!this.pc) return;
        const value = JSON.parse(frame.payload);
        if (frame.kind === "description") {
          if (
            !value ||
            typeof value.sdp !== "string" ||
            !["offer", "answer"].includes(value.type) ||
            (this.host ? value.type !== "answer" : value.type !== "offer")
          )
            throw new Error("Unexpected description");
          await this.pc.setRemoteDescription(value);
          for (const candidate of this.candidates) await this.pc.addIceCandidate(candidate);
          this.candidates.length = 0;
          if (!this.host) {
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            this.signal("description", this.pc.localDescription);
          }
        } else if (frame.kind === "candidate") {
          if (this.pc.remoteDescription) await this.pc.addIceCandidate(value);
          else if (this.candidates.length < 32) this.candidates.push(value);
          else throw new Error("Too many candidates");
        }
      })
      .catch(() => this.finish("Negociación no disponible; WSS continúa"));
  }
  private signal(kind: string, value: unknown) {
    this.link.send({ type: "SIGNAL", kind, payload: JSON.stringify(value) });
  }
  private bind(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      clearTimeout(this.timeout);
      this.report.state = "directo";
      this.status("ICE directo sin STUN/TURN · controles por WSS");
      if (this.host)
        this.timer = setInterval(() => {
          if (channel.readyState !== "open" || channel.bufferedAmount > 8192) return;
          const id = ++this.id;
          this.sent.set(id, performance.now());
          channel.send(`p:${id}`);
          for (const [key, time] of this.sent)
            if (performance.now() - time > 5000) this.sent.delete(key);
        }, 1000);
    };
    channel.onmessage = ({ data }) => {
      if (typeof data !== "string" || !/^[pr]:\d{1,10}$/.test(data)) return;
      if (data.startsWith("p:") && !this.host && channel.readyState === "open")
        channel.send(`r:${data.slice(2)}`);
      if (data.startsWith("r:") && this.host) {
        const id = Number(data.slice(2));
        const time = this.sent.get(id);
        if (time !== undefined) {
          this.report.samples.push(performance.now() - time);
          if (this.report.samples.length > 1800) this.report.samples.shift();
          this.sent.delete(id);
        }
      }
    };
    channel.onerror = () => this.finish("Canal directo no disponible; WSS continúa");
  }
  private finish(message: string) {
    this.dispose();
    this.report.state = message;
    this.status(message);
  }
  dispose() {
    this.closed = true;
    clearTimeout(this.timeout);
    clearInterval(this.timer);
    this.sent.clear();
    this.channel?.close();
    this.pc?.close();
    this.pc = undefined;
  }
}
