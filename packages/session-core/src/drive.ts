export const INPUT_HZ = 30;
export const NEUTRAL_MS = 150;
export const PAUSE_MS = 250;
export const MAX_UNCERTAINTY_MS = 50;

export type Input = {
  steer: number;
  throttle: number;
  brake: number;
  boost: boolean;
  assist: boolean;
};

export const neutral: Input = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  boost: false,
  assist: false,
});

export type DriveMode = "ready" | "countdown" | "racing" | "paused" | "results" | "keyboard";
export type DriveFrame = { epoch: number } & (
  | { type: "INPUT"; seq: number; captured: number; input: Input }
  | { type: "SYNC"; id: number; t0: number }
  | { type: "SYNC_REPLY"; id: number; t0: number; t1: number; t2: number }
  | { type: "DRIVE_PAUSE"; seq: number }
  | { type: "DRIVE_STATE"; mode: DriveMode; speed: number; integrity: number; nitro: number }
  | { type: "FEEDBACK"; id: number; captured: number; kind: "impact" | "boost" | "near" }
);

function num(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function counter(value: unknown): value is number {
  return num(value) && Number.isSafeInteger(value);
}

export function parseDriveFrame(data: Record<string, unknown>): DriveFrame | undefined {
  const { epoch, type, id, t0 } = data;
  if (!counter(epoch)) return;
  if (type === "INPUT" && counter(data.seq) && num(data.captured)) {
    const value = data.input as Partial<Input> | null | undefined;
    if (!value || typeof value !== "object") return;
    const { steer, throttle, brake, boost, assist } = value;
    if (
      num(steer, -1, 1) &&
      num(throttle, 0, 1) &&
      num(brake, 0, 1) &&
      typeof boost === "boolean" &&
      typeof assist === "boolean"
    ) {
      return {
        type,
        epoch,
        seq: data.seq,
        captured: data.captured,
        input: { steer, throttle, brake, boost, assist },
      };
    }
  } else if (type === "SYNC" && counter(id) && num(t0)) {
    return { type, epoch, id, t0 };
  } else if (
    type === "SYNC_REPLY" &&
    counter(id) &&
    num(t0) &&
    num(data.t1) &&
    num(data.t2, data.t1)
  ) {
    return { type, epoch, id, t0, t1: data.t1, t2: data.t2 };
  } else if (type === "DRIVE_PAUSE" && counter(data.seq)) {
    return { type, epoch, seq: data.seq };
  } else if (
    type === "DRIVE_STATE" &&
    num(data.speed, 0, 500) &&
    num(data.integrity, 0, 10) &&
    num(data.nitro, 0, 1)
  ) {
    const { mode, speed, integrity, nitro } = data;
    if (
      mode === "ready" ||
      mode === "countdown" ||
      mode === "racing" ||
      mode === "paused" ||
      mode === "results" ||
      mode === "keyboard"
    )
      return { type, epoch, mode, speed, integrity, nitro };
  } else if (type === "FEEDBACK" && counter(id) && num(data.captured)) {
    const { captured, kind } = data;
    if (kind === "impact" || kind === "boost" || kind === "near")
      return { type, epoch, id, captured, kind };
  }
}

/** Runtime counters live in peer attachments, away from persisted room metadata. */
export interface DriveRate {
  inputsAt: number;
  credit: number;
  seq: number;
  epoch: number;
}

export function permitInput(rate: DriveRate, now: number) {
  rate.credit = Math.min(2, rate.credit + (Math.max(0, now - rate.inputsAt) * INPUT_HZ) / 1000);
  rate.inputsAt = now;
  if (rate.credit < 1) return false;
  rate.credit--;
  return true;
}
