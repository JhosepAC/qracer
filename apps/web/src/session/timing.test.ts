import { expect, it } from "vitest";
import { DriveChannel } from "./drive-channel.ts";
import { InputPipeline, LatencyHistogram } from "./timing.ts";

it("bounds storage while reporting rounded percentiles, invalid samples and long delays", () => {
  const samples = new LatencyHistogram();
  for (let i = 0; i < 10000; i++) samples.add(3.1);
  samples.add(NaN);
  samples.add(-1);
  samples.add(9000);
  expect(samples.summary()).toEqual({
    samples: 10001,
    invalidSamples: 2,
    bucketMs: 0.5,
    p50: 3.5,
    p95: 3.5,
    max: 9000,
  });
  samples.reset();
  expect(samples.summary().p95).toBeNull();
});
it("records each input once and distinguishes superseded inputs from applied frames", () => {
  const pipeline = new InputPipeline();
  pipeline.receive(1, 100);
  pipeline.apply(1, 110);
  pipeline.apply(1, 111);
  pipeline.submit(1, 120);
  pipeline.submit(1, 121);
  pipeline.receive(2, 130);
  pipeline.receive(3, 140);
  pipeline.apply(2, 145);
  pipeline.apply(3, 150);
  pipeline.submit(3, 160);
  expect(pipeline.summary()).toMatchObject({
    received: 3,
    supersededBeforeSimulation: 1,
    receiptToSimulationMs: { samples: 2, p95: 10 },
    receiptToSubmissionMs: { samples: 2, p95: 20 },
  });
  pipeline.reset();
  expect(pipeline.summary().received).toBe(0);
});

it("keeps the 30 Hz schedule from accumulating timer rounding and avoids catch-up bursts", () => {
  const channel = new DriveChannel();
  let count = 0,
    now = 1000;
  while (now < 2000) {
    if (channel.sample(now)) count++;
    now += channel.sampleDelay(now);
  }
  expect(count).toBe(30);
  expect(channel.sample(10000)).toBe(true);
  expect(channel.sampleDelay(10000)).toBe(34);
  expect(channel.sample(10001)).toBe(false);
});
