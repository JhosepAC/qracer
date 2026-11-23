export type Frame = Record<string, unknown>;
export type Input = { steer: number; throttle: number; brake: number; seq: number };
export const neutral = (): Input => ({ steer: 0, throttle: 0, brake: 0, seq: 0 });
export function validInput(value: Frame): value is Frame & Input {
  return (
    [value.steer, value.throttle, value.brake, value.seq].every(Number.isFinite) &&
    Math.abs(Number(value.steer)) <= 1 &&
    Number(value.throttle) >= 0 &&
    Number(value.throttle) <= 1 &&
    Number(value.brake) >= 0 &&
    Number(value.brake) <= 1 &&
    Number.isInteger(value.seq) &&
    Number(value.seq) >= 0
  );
}
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing ${id}`);
  return node as T;
}
export function relayUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Usa el origen HTTPS del relay, sin ruta ni credenciales.");
  if (location.protocol === "https:" && url.protocol !== "https:")
    throw new Error("Se requiere HTTPS.");
  return url;
}

export class ProbeLink {
  readonly socket: WebSocket;
  ready = false;
  connected = false;
  onframe: (frame: Frame) => void = () => {};
  onclose: () => void = () => {};
  constructor(relay: URL, id: string, role: "host" | "controller", token: string) {
    if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(token))
      throw new Error("Invitación inválida.");
    const url = new URL(`/probe/ws/${id}`, relay);
    url.protocol = relay.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(url);
    const deadline = setTimeout(() => this.socket.close(), 6000);
    this.socket.onopen = () => this.socket.send(JSON.stringify({ type: "AUTH", role, token }));
    this.socket.onmessage = ({ data }) => {
      if (typeof data !== "string" || data.length > 16384) return this.close();
      try {
        const frame: Frame = JSON.parse(data);
        if (!frame || typeof frame !== "object") return this.close();
        if (frame.type === "READY") {
          this.ready = true;
          clearTimeout(deadline);
        }
        if (frame.type === "READY" || frame.type === "PEER")
          this.connected = frame.connected === true;
        this.onframe(frame);
      } catch {
        this.close();
      }
    };
    this.socket.onclose = () => {
      clearTimeout(deadline);
      this.ready = false;
      this.connected = false;
      this.onclose();
    };
    this.socket.onerror = () => this.socket.close();
  }
  send(frame: Frame): boolean {
    if (!this.ready || this.socket.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > 8192) {
      this.close();
      return false;
    }
    this.socket.send(JSON.stringify(frame));
    return true;
  }
  close() {
    this.socket.close();
  }
}

export function exportReport(report: Frame) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "qracer-f02.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
