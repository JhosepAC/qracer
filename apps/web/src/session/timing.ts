/** Cumulative 0.5 ms upper-bound histogram. Fixed storage; overflow remains visible. */
export class LatencyHistogram {
  private bins = new Float64Array(4096);
  private count = 0;
  private invalid = 0;
  private maximum = 0;
  reset() {
    this.bins.fill(0);
    this.count = this.invalid = this.maximum = 0;
  }
  add(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) {
      this.invalid++;
      return;
    }
    const bin = Math.min(this.bins.length - 1, Math.ceil(ms * 2));
    this.bins[bin] = (this.bins[bin] ?? 0) + 1;
    this.count++;
    this.maximum = Math.max(this.maximum, ms);
  }
  summary() {
    const percentile = (fraction: number) => {
      if (!this.count) return null;
      let count = 0;
      for (let i = 0; i < this.bins.length; i++) {
        count += this.bins[i] ?? 0;
        if (count >= Math.ceil(this.count * fraction))
          return i === this.bins.length - 1 ? this.maximum : i / 2;
      }
      return this.maximum;
    };
    return {
      samples: this.count,
      invalidSamples: this.invalid,
      bucketMs: 0.5,
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: this.count ? this.maximum : null,
    };
  }
}

/** Measures only the PC's monotonic receipt/apply/submission clock, never physical latency. */
export class InputPipeline {
  private seq = -1;
  private at = 0;
  private used = false;
  private painted = false;
  private received = 0;
  private superseded = 0;
  private simulation = new LatencyHistogram();
  private submission = new LatencyHistogram();
  reset() {
    this.seq = -1;
    this.at = 0;
    this.used = this.painted = false;
    this.received = this.superseded = 0;
    this.simulation.reset();
    this.submission.reset();
  }
  receive(seq: number, now: number) {
    if (seq <= this.seq || !Number.isFinite(now)) return;
    if (this.seq >= 0 && !this.used) this.superseded++;
    this.seq = seq;
    this.at = now;
    this.used = this.painted = false;
    this.received++;
  }
  apply(seq: number, now: number) {
    if (seq !== this.seq || this.used || now < this.at) return;
    this.used = true;
    this.simulation.add(now - this.at);
  }
  submit(seq: number, now: number) {
    if (seq !== this.seq || !this.used || this.painted || now < this.at) return;
    this.painted = true;
    this.submission.add(now - this.at);
  }
  summary() {
    return {
      clock: "PC performance.now",
      scope: "racing frames since last start/epoch",
      meaning: "receipt to simulation and frame submission; not input-to-display latency",
      received: this.received,
      supersededBeforeSimulation: this.superseded,
      receiptToSimulationMs: this.simulation.summary(),
      receiptToSubmissionMs: this.submission.summary(),
    };
  }
}
