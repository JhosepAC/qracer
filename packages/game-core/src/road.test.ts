import { expect, it } from "vitest";
import {
  advanceTraffic,
  emptyTraffic,
  firstSegment,
  laneCenters,
  MAX_TRAFFIC,
  openLane,
  ROAD_SEGMENTS,
  roadPose,
  ROW_SPACING,
  SEGMENT_LENGTH,
  trafficPattern,
  trafficPosition,
} from "./index.ts";

const pose = () => ({ x: 0, z: 0, heading: 0 });

it("joins every curve smoothly and recenters without moving the road relative to the player", () => {
  for (const i of [-17, -1, 0, 1, 2, 3, 15, 16, 17, 2_000_001]) {
    const s = i * SEGMENT_LENGTH;
    const before = roadPose(s - 0.0001, 4, i, pose());
    const seam = roadPose(s, 4, i, pose());
    expect(Math.hypot(before.x - seam.x, before.z - seam.z)).toBeLessThan(0.001);
    expect(before.heading).toBeCloseTo(seam.heading, 5);
    const car = roadPose(s + 2, -4, i, pose());
    const otherOriginSeam = roadPose(s, 4, i - 1, pose());
    const otherOriginCar = roadPose(s + 2, -4, i - 1, pose());
    expect(car.x - seam.x).toBeCloseTo(otherOriginCar.x - otherOriginSeam.x, 10);
    expect(car.z - seam.z).toBeCloseTo(otherOriginCar.z - otherOriginSeam.z, 10);
    expect(firstSegment(s) + ROAD_SEGMENTS).toBeGreaterThan(i);
  }
});

it("reproduces traffic, keeps a continuous escape lane and bounds recycling at both speed limits", () => {
  for (const speed of [50 / 3.6, 200 / 3.6]) {
    let world = emptyTraffic;
    let peak = 0;
    for (let tick = 0; tick <= 36_000; tick++) {
      const s = (tick * speed) / 60;
      world = advanceTraffic(world, 310, s, tick);
      peak = Math.max(
        peak,
        world.rows.reduce((n, row) => n + row.cars.length, 0),
      );
      for (const row of world.rows)
        if (row.tick === tick)
          expect(trafficPosition(row, tick) - s).toBeGreaterThanOrEqual(ROW_SPACING);
    }
    expect(peak).toBeLessThanOrEqual(MAX_TRAFFIC);
    expect(world.nextRow).toBeGreaterThan(40);
  }
  for (let seed = 0; seed < 256; seed++) {
    const safe = laneCenters[openLane(seed)];
    const cars = trafficPattern(seed, 3);
    expect(cars.length).toBeGreaterThan(0);
    expect(cars.every((car) => car.d !== safe)).toBe(true);
    expect(trafficPattern(seed, 3)).toEqual(cars);
  }
});
