import {
  type DriveFrame,
  INPUT_HZ,
  MAX_UNCERTAINTY_MS,
  NEUTRAL_MS,
  neutral,
  PAUSE_MS,
} from "@qracer/session-core/wire";

type Probe = Extract<DriveFrame, { type: "SYNC_REPLY" }>;
type Snapshot = Extract<DriveFrame, { type: "INPUT" }>;
type Transmission = (frame: DriveFrame) => boolean;
const SYNC_INTERVAL = 500;
const SAMPLE_TTL = 8_000;

export class ClockSync {
  private samples: { at: number; offset: number; rtt: number }[] = [];
  private outstanding?: { id: number; t0: number };
  private id = 0;

  request(now: number) {
    if (this.outstanding && now - this.outstanding.t0 < SYNC_INTERVAL) return;
    this.outstanding = { id: ++this.id, t0: now };
    return this.outstanding;
  }

  answer(frame: Probe, now: number) {
    if (frame.id !== this.outstanding?.id || frame.t0 !== this.outstanding.t0) return;
    delete this.outstanding;
    const processing = frame.t2 - frame.t1;
    const rtt = now - frame.t0 - processing;
    if (processing < 0 || rtt < 0 || rtt > 1000) return;
    const offset = (frame.t1 - frame.t0 + (frame.t2 - now)) / 2;
    this.samples.push({ rtt, offset, at: now });
    if (this.samples.length > 8) this.samples.shift();
  }

  estimate(now: number) {
    const live = this.samples.filter((sample) => now - sample.at <= SAMPLE_TTL);
    if (live.length < 3) return;
    let best = live[0];
    for (const sample of live) if (best && sample.rtt < best.rtt) best = sample;
    if (best) return { ...best, uncertainty: best.rtt / 2 + 1 };
  }

  receiveTime(captured: number, now: number, maxAge = NEUTRAL_MS) {
    const estimate = this.estimate(now);
    if (!estimate || estimate.uncertainty > MAX_UNCERTAINTY_MS) return;
    const local = captured - estimate.offset;
    const age = now - local;
    if (age < -estimate.uncertainty || age > maxAge + estimate.uncertainty) return;
    return Math.min(now, local);
  }
}

export class DriveChannel {
  epoch: number | undefined;
  sync = new ClockSync();
  private send: Transmission | undefined;
  private nextProbe = 0;
  private nextSample = 0;

  configure(epoch: number | undefined, send?: Transmission) {
    if (this.epoch !== epoch) {
      this.sync = new ClockSync();
      this.nextProbe = 0;
      this.nextSample = 0;
    }
    this.epoch = epoch;
    this.send = send;
  }

  tick(now: number) {
    if (this.epoch === undefined || now < this.nextProbe) return;
    this.nextProbe = now + SYNC_INTERVAL;
    const request = this.sync.request(now);
    if (request) this.send?.({ type: "SYNC", epoch: this.epoch, ...request });
  }

  receive(frame: DriveFrame, now: number) {
    if (this.epoch !== frame.epoch) return false;
    if (frame.type === "SYNC") {
      this.send?.({
        type: "SYNC_REPLY",
        epoch: frame.epoch,
        id: frame.id,
        t0: frame.t0,
        t1: now,
        t2: performance.now(),
      });
      return false;
    }
    if (frame.type === "SYNC_REPLY") {
      this.sync.answer(frame, now);
      return false;
    }
    return true;
  }

  sample(now: number) {
    if (now + 0.001 < this.nextSample) return false;
    this.nextSample = now + 1000 / INPUT_HZ;
    return true;
  }
}

export class RemoteInput {
  captured = -Infinity;
  received = -Infinity;
  seq = -1;
  value = neutral;
  rejected = 0;
  accepted = 0;
  private epoch: number | undefined;

  configure(epoch: number | undefined) {
    if (this.epoch === epoch) return;
    this.epoch = epoch;
    this.seq = -1;
    this.clear();
  }

  clear() {
    this.captured = this.received = -Infinity;
    this.value = neutral;
  }

  accept(frame: Snapshot, captured: number | undefined, now: number) {
    if (frame.epoch !== this.epoch || frame.seq <= this.seq || captured === undefined) {
      this.rejected++;
      return;
    }
    this.seq = frame.seq;
    this.received = now;
    this.captured = captured;
    this.value = frame.input;
    this.accepted++;
  }

  age(now: number) {
    return now - this.captured;
  }

  timedOut(now: number) {
    return this.age(now) >= PAUSE_MS;
  }

  get(now: number) {
    if (this.age(now) >= NEUTRAL_MS) return neutral;
    const { steer, throttle, brake, boost, assist } = this.value;
    return {
      steer: assist ? steer * 0.7 : steer,
      throttle: brake > 0 ? 0 : Math.min(throttle, assist ? 0.35 : 1),
      brake,
      boost: boost && brake === 0 && !assist,
      assist,
    };
  }

  ready(now: number) {
    const input = this.value;
    return (
      this.age(now) < NEUTRAL_MS &&
      Math.abs(input.steer) < 0.08 &&
      input.throttle === 0 &&
      input.brake === 0 &&
      !input.boost
    );
  }
}
