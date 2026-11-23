import {
  AUTH_MS,
  INVITE_MS,
  type ClientFrame,
  type Creation,
  type ErrorCode,
  type Phase,
  RECONNECT_MS,
  ROOM_ID,
  type Role,
  type ServerFrame,
  SESSION_BYTES,
  SESSION_VERSION,
  TOKEN,
} from "@qracer/session-core/wire";

const errors: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "La vinculación no se autenticó a tiempo.",
  UNAUTHORIZED: "La credencial ya no es válida. Pide una nueva invitación.",
  INVITE_EXPIRED: "La invitación caducó o ya fue usada. Pide una nueva.",
  REVOKED: "La PC rechazó o revocó este mando.",
  ROOM_EXPIRED: "La sala caducó o fue cerrada. Crea una nueva desde la PC.",
  QUOTA_EXHAUSTED: "Cuota de vinculación agotada. Puedes usar el teclado o la edición local.",
  VERSION_MISMATCH: "Versión incompatible. Actualiza la página en ambos dispositivos.",
  INVALID: "La acción ya no está disponible.",
  BUSY: "El dispositivo anterior sigue conectado. Intenta de nuevo.",
};

export function sessionError(code: ErrorCode) {
  return errors[code];
}

function relayOrigin() {
  const configured: string | undefined = import.meta.env.VITE_SESSION_RELAY;
  const url = new URL(configured || location.origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && (url.origin === location.origin || local)))
  ) {
    throw new Error("El origen del relay es inválido.");
  }
  return url.origin;
}

function object(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return;
  }
}

const phases = new Set<Phase>(["waiting", "pending", "connected", "reconnecting"]);

function parseServer(raw: string): ServerFrame | undefined {
  if (raw.length > SESSION_BYTES) return;
  const data = object(raw);
  if (!data) return;
  switch (data.type) {
    case "STATE": {
      const { phase, epoch, until, request, code, linked } = data;
      if (
        typeof phase !== "string" ||
        !phases.has(phase as Phase) ||
        typeof epoch !== "number" ||
        !Number.isSafeInteger(epoch) ||
        epoch < 0 ||
        typeof until !== "number" ||
        !Number.isSafeInteger(until) ||
        typeof linked !== "boolean"
      )
        return;
      return {
        type: "STATE",
        phase: phase as Phase,
        epoch,
        until,
        linked,
        ...(typeof request === "string" && ROOM_ID.test(request) ? { request } : {}),
        ...(typeof code === "string" && /^\d{6}$/.test(code) ? { code } : {}),
      };
    }
    case "INVITE":
      if (
        typeof data.token === "string" &&
        TOKEN.test(data.token) &&
        typeof data.until === "number" &&
        Number.isSafeInteger(data.until) &&
        typeof data.ttl === "number" &&
        Number.isSafeInteger(data.ttl) &&
        data.ttl >= 0 &&
        data.ttl <= INVITE_MS
      )
        return { type: "INVITE", token: data.token, until: data.until, ttl: data.ttl };
      return;
    case "RESUME":
      if (typeof data.token === "string" && TOKEN.test(data.token))
        return { type: "RESUME", token: data.token };
      return;
    case "ERROR":
      if (typeof data.code === "string" && Object.hasOwn(errors, data.code))
        return { type: "ERROR", code: data.code as ErrorCode };
  }
}

export interface RoomToken {
  room: string;
  token: string;
}

export function controllerUrl({ room, token }: RoomToken) {
  const link = new URL("/controller/", location.origin);
  link.hash = new URLSearchParams({ room, invite: token }).toString();
  return link.href;
}

export function parseInvitation(raw: string): RoomToken | undefined {
  if (raw.length > 512) return;
  try {
    const url = new URL(raw);
    if (
      url.origin !== location.origin ||
      url.pathname !== "/controller/" ||
      url.search ||
      url.username ||
      url.password
    )
      return;
    const params = new URLSearchParams(url.hash.slice(1));
    const room = params.get("room");
    const token = params.get("invite");
    if (room && token && ROOM_ID.test(room) && TOKEN.test(token)) return { room, token };
  } catch {
    return;
  }
}

export async function createSession(signal: AbortSignal): Promise<Creation> {
  const response = await fetch(`${relayOrigin()}/session`, {
    method: "POST",
    signal,
    redirect: "error",
    credentials: "omit",
  });
  if (response.status === 429) throw new Error(sessionError("QUOTA_EXHAUSTED"));
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Relay no disponible. Abre la edición local de QRacer para vincular el móvil.");
  const data = object(await response.text());
  if (data?.version !== SESSION_VERSION) throw new Error(sessionError("VERSION_MISMATCH"));
  if (
    typeof data.room !== "string" ||
    !ROOM_ID.test(data.room) ||
    typeof data.hostToken !== "string" ||
    !TOKEN.test(data.hostToken)
  )
    throw new Error("La sala no pudo crearse.");
  return { version: SESSION_VERSION, room: data.room, hostToken: data.hostToken };
}

type Hooks = {
  frame: (frame: ServerFrame) => void;
  reconnecting: () => void;
  ended: (message: string) => void;
};

export class SessionLink {
  private socket?: WebSocket;
  private authTimer = 0;
  private retryTimer = 0;
  private until = 0;
  private attempts = 0;
  private ready = false;
  private closed = false;
  private readonly key: RoomToken;
  private role: Role;
  private readonly hooks: Hooks;

  constructor(key: RoomToken, role: Role, hooks: Hooks) {
    this.key = { ...key };
    this.role = role;
    this.hooks = hooks;
  }

  open() {
    if (!this.closed && !this.socket) this.connect();
  }

  private connect() {
    let address: string;
    try {
      address = relayOrigin();
    } catch {
      return this.finish("El origen del relay es inválido.");
    }
    const socket = new WebSocket(`${address.replace(/^http/, "ws")}/session/ws/${this.key.room}`);
    this.socket = socket;
    this.authTimer = window.setTimeout(() => socket.close(), AUTH_MS + 1000);
    socket.onopen = () => {
      if (this.socket !== socket || this.closed) return;
      socket.send(
        JSON.stringify({
          type: "AUTH",
          version: SESSION_VERSION,
          role: this.role,
          token: this.key.token,
        }),
      );
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.closed || typeof event.data !== "string") return;
      const frame = parseServer(event.data);
      if (!frame) return this.finish("El relay envió una respuesta inválida.");
      if (frame.type === "ERROR") {
        if (frame.code === "INVALID") return this.hooks.frame(frame);
        if (frame.code === "BUSY" && this.role !== "invite") return socket.close();
        return this.finish(sessionError(frame.code));
      }
      if (frame.type === "STATE") {
        this.ready = true;
        this.until = 0;
        this.attempts = 0;
        window.clearTimeout(this.authTimer);
      } else if (frame.type === "RESUME" && this.role !== "host") {
        this.role = "resume";
        this.key.token = frame.token;
      }
      this.hooks.frame(frame);
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.closed) return;
      window.clearTimeout(this.authTimer);
      delete this.socket;
      this.ready = false;
      if (this.role === "invite")
        return this.finish("Se perdió el enlace. Pide una nueva invitación.");
      if (!this.until) this.until = performance.now() + RECONNECT_MS;
      const remaining = this.until - performance.now();
      if (remaining <= 0) return this.finish(sessionError("ROOM_EXPIRED"));
      this.hooks.reconnecting();
      const delay = Math.min(4000, 300 * 2 ** this.attempts++) * (0.85 + Math.random() * 0.3);
      this.retryTimer = window.setTimeout(
        () => {
          if (performance.now() < this.until) this.connect();
          else this.finish(sessionError("ROOM_EXPIRED"));
        },
        Math.min(delay, remaining),
      );
    };
  }

  send(frame: ClientFrame): boolean {
    if (
      !this.ready ||
      this.socket?.readyState !== WebSocket.OPEN ||
      this.socket.bufferedAmount > 8192
    )
      return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private finish(message: string) {
    this.dispose();
    this.hooks.ended(message);
  }

  dispose(endRoom = false) {
    if (this.closed) return;
    if (endRoom && this.role === "host") this.send({ type: "END" });
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.authTimer);
    this.socket?.close();
    delete this.socket;
  }
}
