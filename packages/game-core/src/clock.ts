import { TICK_HZ } from "./driving.ts";

const STEP_MS = 1000 / TICK_HZ;
const EPSILON = 1e-7;
export const MAX_CATCH_UP = 5;
export const SUSPEND_MS = 250;

/** A render adapter. Simulation advances only in the supplied tick function. */
export class FixedClock<T> {
  previous: T;
  current: T;
  paused = false;
  tick = 0;
  private last: number | undefined;
  private remainder = 0;

  private readonly step: (state: T, tick: number) => T;

  constructor(initial: T, step: (state: T, tick: number) => T) {
    this.step = step;
    this.previous = this.current = initial;
  }

  reset(initial: T) {
    this.previous = this.current = initial;
    this.tick = 0;
    this.pause();
  }

  pause() {
    this.paused = true;
    this.remainder = 0;
    this.last = undefined;
    this.previous = this.current;
  }

  resume() {
    this.paused = false;
    this.last = undefined;
  }

  frame(now: number): number {
    if (this.paused) return 0;
    const delta = this.last === undefined ? 0 : now - this.last;
    if (!Number.isFinite(now) || delta < 0 || delta > SUSPEND_MS) {
      this.pause();
      return 0;
    }
    this.last = now;
    this.remainder += delta;
    const due = Math.floor((this.remainder + EPSILON) / STEP_MS);
    this.remainder = Math.max(0, this.remainder - due * STEP_MS);
    for (let i = 0; i < Math.min(due, MAX_CATCH_UP); i++) {
      this.previous = this.current;
      this.current = this.step(this.current, this.tick++);
      if (this.paused) break;
    }
    return this.remainder / STEP_MS;
  }
}
