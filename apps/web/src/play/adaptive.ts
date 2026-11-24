import type { Quality } from "./quality.ts";

/** Bounded one-second windows; no per-frame sorting or allocations. */
export class ResolutionGovernor {
  private frames = new Float64Array(256);
  private work = new Float64Array(256);
  private count = 0;
  private at = 0;
  private start: number | undefined;
  private poor: number | undefined;
  private stable: number | undefined;
  private level = 0;
  private levels: readonly number[];
  readonly budget: number;
  constructor(quality: Quality) {
    this.budget = quality === "low" ? 33.4 : 16.7;
    this.levels = quality === "low" ? [1, 0.9, 0.8, 0.7] : [1, 0.9, 0.8, 0.75];
  }
  get scale() {
    return this.levels[this.level] ?? 1;
  }
  pause() {
    this.start = this.poor = this.stable = undefined;
    this.count = this.at = 0;
  }
  sample(now: number, frame: number, work: number, enabled = true) {
    if (!enabled) {
      this.level = 0;
      this.pause();
      return this.scale;
    }
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(frame) ||
      !Number.isFinite(work) ||
      frame <= 0 ||
      frame > 250 ||
      work < 0
    ) {
      this.pause();
      return this.scale;
    }
    this.start ??= now - frame;
    if (now < this.start) {
      this.pause();
      return this.scale;
    }
    this.frames[this.at] = frame;
    this.work[this.at] = work;
    this.at = (this.at + 1) % this.frames.length;
    this.count = Math.min(this.count + 1, this.frames.length);
    if (now - this.start < 1000) return this.scale;
    const p95 = (values: Float64Array) =>
      values.slice(0, this.count).sort()[Math.ceil(this.count * 0.95) - 1] ?? 0;
    const interval = p95(this.frames),
      cost = p95(this.work);
    // Sub-ms RAF quantization at vsync is not evidence that fewer pixels will help.
    // Acceptance reports still compare the unmodified samples against 16.7/33.4 ms.
    if (interval > this.budget + 0.5 || cost > this.budget) {
      this.stable = undefined;
      this.poor ??= this.start;
      if (now - this.poor >= 5000) {
        this.level = Math.min(this.level + 1, this.levels.length - 1);
        this.poor = now;
      }
    } else if (interval <= this.budget + 0.5 && cost < this.budget * 0.6) {
      this.poor = undefined;
      this.stable ??= this.start;
      if (now - this.stable >= 20000) {
        this.level = Math.max(0, this.level - 1);
        this.stable = now;
      }
    } else this.poor = this.stable = undefined;
    this.start = now;
    this.count = this.at = 0;
    return this.scale;
  }
}
