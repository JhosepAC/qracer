import { ROOM_ID, ROOM_MS, TOKEN } from "@qracer/session-core/wire";

export interface ResumeRecord {
  room: string;
  token: string;
  until: number;
}
/** Capabilities are tab-scoped, finite and never part of progress exports. */
export function parseResume(raw: string | null, now = Date.now()): ResumeRecord | undefined {
  if (!raw || raw.length > 256) return;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !["room", "token", "until"].includes(key))
    )
      return;
    if (
      typeof value.room === "string" &&
      ROOM_ID.test(value.room) &&
      typeof value.token === "string" &&
      TOKEN.test(value.token) &&
      Number.isSafeInteger(value.until) &&
      value.until > now &&
      value.until <= now + ROOM_MS
    )
      return { room: value.room, token: value.token, until: value.until };
  } catch {
    /* Invalid or legacy records are discarded by the controller. */
  }
}
