import { GENERATOR_VERSION, RULES_VERSION, type Race } from "@qracer/game-core";
import { bounded, categoryInfo, fields, MAX_IMPORT, object } from "./model.ts";
export interface Ghost {
  schemaVersion: 1;
  category: string;
  score: number;
  ended: number;
  buffer: ArrayBuffer;
}
export interface GhostPose {
  s: number;
  d: number;
  turn: number;
}
const HEADER = 16,
  STRIDE = 16,
  MAGIC = 0x51524748;
export const MAX_GHOST_SAMPLES = Math.floor((MAX_IMPORT - HEADER) / STRIDE);
export class GhostRecorder {
  private view: DataView;
  private count = 0;
  private last = -1;
  private capped = false;
  constructor(ticks: number) {
    if (!Number.isFinite(ticks) || ticks < 0) throw new RangeError("Invalid ghost duration");
    this.view = new DataView(
      new ArrayBuffer(HEADER + Math.min(MAX_GHOST_SAMPLES, Math.ceil(ticks / 3) + 2) * STRIDE),
    );
  }
  get samples() {
    return this.count;
  }
  get bytes() {
    return this.view.byteLength;
  }
  capture(race: Race) {
    if (
      race.phase === "countdown" ||
      race.tick === this.last ||
      (race.tick % 3 !== 0 && race.phase !== "finished")
    )
      return;
    if (HEADER + (this.count + 1) * STRIDE > this.view.byteLength) {
      this.capped = true;
      return;
    }
    const at = HEADER + this.count * STRIDE;
    this.view.setUint32(at, race.tick, true);
    this.view.setFloat32(at + 4, race.driver.s, true);
    this.view.setFloat32(at + 8, race.driver.d, true);
    this.view.setFloat32(at + 12, -race.driver.lateral * 0.024, true);
    this.last = race.tick;
    this.count++;
  }
  finish(race: Race, ended = Date.now()): Ghost | undefined {
    if (race.phase !== "finished" || !["time-trial", "daily"].includes(race.run.mode)) return;
    this.capture(race);
    if (this.capped || this.count < 2) return;
    this.view.setUint32(0, MAGIC, true);
    this.view.setUint32(4, 1, true);
    this.view.setUint32(8, this.count, true);
    this.view.setUint32(12, this.last, true);
    return {
      schemaVersion: 1,
      category: race.run.category,
      score: race.score,
      ended,
      buffer: this.view.buffer.slice(0, HEADER + this.count * STRIDE) as ArrayBuffer,
    };
  }
}
const axes = [
  ["s", 4],
  ["d", 8],
  ["turn", 12],
] as const;
export class GhostPlayback {
  private pose: GhostPose = { s: 0, d: 0, turn: 0 };
  private view: DataView;
  readonly samples: number;
  readonly durationTicks: number;
  constructor(view: DataView, samples: number, durationTicks: number) {
    this.view = view;
    this.samples = samples;
    this.durationTicks = durationTicks;
  }
  at(tick: number): GhostPose | undefined {
    if (!Number.isFinite(tick) || tick < 0 || tick > this.durationTicks) return;
    let lo = 0,
      hi = this.samples - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.view.getUint32(HEADER + mid * STRIDE, true) <= tick) lo = mid;
      else hi = mid;
    }
    const a = HEADER + lo * STRIDE,
      b = HEADER + hi * STRIDE;
    const from = this.view.getUint32(a, true),
      to = this.view.getUint32(b, true);
    const t = Math.max(0, Math.min(1, (tick - from) / (to - from)));
    for (const [key, offset] of axes) {
      const value = this.view.getFloat32(a + offset, true);
      this.pose[key] = value + (this.view.getFloat32(b + offset, true) - value) * t;
    }
    return this.pose;
  }
}
export function readGhost(value: unknown, expected: string): GhostPlayback | undefined {
  try {
    if (!object(value)) return;
    fields(value, ["schemaVersion", "category", "score", "ended", "buffer"]);
    const info = categoryInfo(value.category);
    if (
      value.schemaVersion !== 1 ||
      value.category !== expected ||
      !info ||
      !["time-trial", "daily"].includes(info.mode) ||
      info.rulesVersion !== RULES_VERSION ||
      info.generatorVersion !== GENERATOR_VERSION ||
      !bounded(value.score) ||
      !bounded(value.ended, 4102444800000) ||
      !(value.buffer instanceof ArrayBuffer) ||
      value.buffer.byteLength > MAX_IMPORT ||
      value.buffer.byteLength < HEADER + 2 * STRIDE
    )
      return;
    const view = new DataView(value.buffer),
      count = view.getUint32(8, true),
      duration = view.getUint32(12, true);
    if (
      view.getUint32(0, true) !== MAGIC ||
      view.getUint32(4, true) !== 1 ||
      count < 2 ||
      HEADER + count * STRIDE !== view.byteLength ||
      duration > 7200
    )
      return;
    let last = -1,
      previousS = 0;
    for (let i = 0; i < count; i++) {
      const at = HEADER + i * STRIDE,
        tick = view.getUint32(at, true),
        s = view.getFloat32(at + 4, true),
        d = view.getFloat32(at + 8, true),
        turn = view.getFloat32(at + 12, true);
      if (
        (i === 0 && tick !== 0) ||
        (i > 0 && (tick <= last || tick - last > 3 || (i < count - 1 && tick - last !== 3))) ||
        !Number.isFinite(s) ||
        s < previousS - 0.01 ||
        s > 1e9 ||
        !Number.isFinite(d) ||
        Math.abs(d) > 5.06 ||
        !Number.isFinite(turn) ||
        Math.abs(turn) > 1
      )
        return;
      last = tick;
      previousS = s;
    }
    if (last !== duration) return;
    return new GhostPlayback(view, count, duration);
  } catch {
    return;
  }
}
