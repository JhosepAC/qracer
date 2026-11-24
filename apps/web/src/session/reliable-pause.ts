import type { DriveFrame } from "@qracer/session-core/wire";
type Pause = Extract<DriveFrame, { type: "DRIVE_PAUSE" }>;

/** One outstanding action, bounded retries. A new epoch cancels old work. */
export class ReliablePause {
  private pending?: { frame: Pause; at: number; attempts: number };
  sent(frame: Pause, now: number) {
    this.pending = { frame, at: now, attempts: 1 };
  }
  reset() {
    delete this.pending;
  }
  ack(epoch: number, seq: number) {
    if (this.pending?.frame.epoch === epoch && this.pending.frame.seq === seq) this.reset();
  }
  tick(now: number, send: (frame: Pause) => boolean, fail: () => void) {
    const pending = this.pending;
    if (!pending || now - pending.at < 100) return;
    if (pending.attempts++ >= 3) {
      this.reset();
      fail();
      return;
    }
    pending.at = now;
    send(pending.frame);
  }
}
