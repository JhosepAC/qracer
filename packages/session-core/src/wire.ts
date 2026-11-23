import { type DriveFrame, parseDriveFrame } from "./drive.ts";
export * from "./drive.ts";

export const SESSION_VERSION = 2;
export const SESSION_BYTES = 1024;
export const ROOM_ID = /^[0-9a-f]{32}$/;
export const TOKEN = /^[0-9a-f]{64}$/;
export const INVITE_MS = 120_000;
export const RECONNECT_MS = 30_000;
export const AUTH_MS = 5_000;
export const ROOM_MS = 2 * 60 * 60_000;
export const LEASE_MS = 15 * 60_000;
export const MAX_PEERS = 4;

export type Role = "host" | "invite" | "resume";
export type Phase = "waiting" | "pending" | "connected" | "reconnecting";
export type ErrorCode =
  | "AUTH_REQUIRED"
  | "UNAUTHORIZED"
  | "INVITE_EXPIRED"
  | "REVOKED"
  | "ROOM_EXPIRED"
  | "QUOTA_EXHAUSTED"
  | "VERSION_MISMATCH"
  | "INVALID"
  | "BUSY";

export interface Creation {
  version: number;
  room: string;
  hostToken: string;
}

export type ClientFrame =
  | DriveFrame
  | { type: "AUTH"; version: number; role: Role; token: string }
  | { type: "ROTATE" | "REVOKE" | "END" }
  | { type: "APPROVE" | "REJECT"; request: string };

export type ServerFrame =
  | DriveFrame
  | {
      type: "STATE";
      phase: Phase;
      epoch: number;
      until: number;
      linked: boolean;
      request?: string;
      code?: string;
    }
  | { type: "INVITE"; token: string; until: number; ttl: number }
  | { type: "RESUME"; token: string }
  | { type: "ERROR"; code: ErrorCode };

export function parseClient(raw: string): ClientFrame | undefined {
  if (raw.length > SESSION_BYTES) return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  const type = msg.type;
  switch (type) {
    case "AUTH": {
      const { role, version, token } = msg;
      if (
        typeof version === "number" &&
        Number.isSafeInteger(version) &&
        (role === "host" || role === "invite" || role === "resume") &&
        typeof token === "string" &&
        TOKEN.test(token)
      )
        return { type, role, version, token };
      return;
    }
    case "APPROVE":
    case "REJECT":
      if (typeof msg.request === "string" && ROOM_ID.test(msg.request))
        return { type, request: msg.request };
      return;
    case "ROTATE":
    case "REVOKE":
    case "END":
      return { type };
    default:
      return parseDriveFrame(msg);
  }
}
