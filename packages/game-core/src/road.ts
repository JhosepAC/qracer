import { ROAD_HALF_WIDTH } from "./driving.ts";

export const SEGMENT_LENGTH = 24;
export const ROAD_BEHIND = 3;
export const ROAD_AHEAD = 13;
export const ROAD_SEGMENTS = ROAD_BEHIND + ROAD_AHEAD + 1;
const CURVE = 1 / 400;
const pattern = [0, 1, 1, 0, -1, -1, 0, 0, 0, -1, -1, 0, 1, 1, 0, 0];

export interface RoadPose {
  x: number;
  z: number;
  heading: number;
}

export function arc(distance: number, curvature: number, out: RoadPose): RoadPose {
  const angle = distance * curvature;
  out.x = curvature === 0 ? 0 : (1 - Math.cos(angle)) / curvature;
  out.z = curvature === 0 ? -distance : -Math.sin(angle) / curvature;
  out.heading = angle;
  return out;
}

const starts: RoadPose[] = [{ x: 0, z: 0, heading: 0 }];
for (const curve of pattern) {
  const start = starts[starts.length - 1]!;
  const end = arc(SEGMENT_LENGTH, curve * CURVE, { x: 0, z: 0, heading: 0 });
  const cos = Math.cos(start.heading);
  const sin = Math.sin(start.heading);
  starts.push({
    x: start.x + end.x * cos - end.z * sin,
    z: start.z + end.x * sin + end.z * cos,
    heading: start.heading + end.heading,
  });
}
const cycleEnd = starts[pattern.length]!;

function offset(index: number): number {
  return index - Math.floor(index / pattern.length) * pattern.length;
}

export function segmentCurvature(index: number): number {
  return (pattern[offset(index)] ?? 0) * CURVE;
}

export function firstSegment(s: number): number {
  return Math.floor(s / SEGMENT_LENGTH) - ROAD_BEHIND;
}

/** Origin is the centre of a nearby segment. Score never uses these local coordinates. */
export function roadPose(s: number, d: number, originIndex: number, out: RoadPose): RoadPose {
  const index = Math.floor(s / SEGMENT_LENGTH);
  const start = starts[offset(index)]!;
  const origin = starts[offset(originIndex)]!;
  const cycles = Math.floor(index / pattern.length) - Math.floor(originIndex / pattern.length);
  arc(s - index * SEGMENT_LENGTH, segmentCurvature(index), out);
  const cos = Math.cos(start.heading);
  const sin = Math.sin(start.heading);
  const heading = start.heading + out.heading;
  const localX = out.x;
  out.x =
    cycles * cycleEnd.x + (start.x - origin.x) + localX * cos - out.z * sin + d * Math.cos(heading);
  out.z =
    cycles * cycleEnd.z + (start.z - origin.z) + localX * sin + out.z * cos + d * Math.sin(heading);
  out.heading = heading;
  return out;
}

export const laneCenters = [(-ROAD_HALF_WIDTH * 2) / 3, 0, (ROAD_HALF_WIDTH * 2) / 3] as const;
