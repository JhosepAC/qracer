import { expect, it } from "vitest";
import { Histogram } from "./render-metrics.ts";

it("retains aggregate percentiles without an unbounded frame history", () => {
  const histogram = new Histogram();
  for (let i = 0; i < 95; i++) histogram.add(16.7);
  for (let i = 0; i < 4; i++) histogram.add(33.3);
  histogram.add(1200);
  histogram.add(Number.NaN);
  expect(histogram.summary()).toEqual({
    samples: 100,
    p50Ms: 16.7,
    p95Ms: 16.7,
    p99Ms: 33.3,
    over50Ms: 1,
  });
  expect(histogram.percentile(1)).toBe(500);
});
