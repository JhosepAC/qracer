import { STEP_SECONDS } from "./driving.ts";
import { laneCenters } from "./road.ts";

export const GENERATOR_VERSION = 1;
export const ROW_SPACING = 160;
export const TRAFFIC_LOOKAHEAD = 256;
export const TRAFFIC_SPEED = 10;
const KEEP_BEHIND = 28;
export const MAX_TRAFFIC_ROWS = 9;
export const MAX_TRAFFIC = MAX_TRAFFIC_ROWS * 2;

export interface TrafficCar {
  readonly id: number;
  readonly d: number;
  readonly paint: number;
}

export interface TrafficRow {
  readonly s: number;
  readonly tick: number;
  readonly cars: readonly TrafficCar[];
}

export interface Traffic {
  readonly nextRow: number;
  readonly rows: readonly TrafficRow[];
}

export const emptyTraffic: Traffic = { nextRow: 1, rows: [] };

/** Independent streams by seed, version, row and subsystem; no mutable random cursor. */
export function randomWord(seed: number, index: number, stream: number): number {
  let value =
    (seed | 0) ^ Math.imul(index, 0x9e3779b1) ^ Math.imul(stream + GENERATOR_VERSION, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function openLane(seed: number): number {
  return randomWord(seed, 0, 0) % laneCenters.length;
}

/** A candidate that blocks the continuous escape lane is replaced by a safe row. */
export function trafficPattern(seed: number, row: number): readonly TrafficCar[] {
  const escape = openLane(seed);
  const mask = randomWord(seed, row, 1) & 7;
  const safeMask = 1 << ((escape + 1 + (row % 2)) % 3);
  const chosen = mask === 0 || mask & (1 << escape) ? safeMask : mask;
  return laneCenters.flatMap((d, lane) =>
    chosen & (1 << lane)
      ? [{ id: row * 3 + lane, d, paint: randomWord(seed, row, 2 + lane) % 4 }]
      : [],
  );
}

export function trafficPosition(row: TrafficRow, tick: number): number {
  return row.s + (tick - row.tick) * STEP_SECONDS * TRAFFIC_SPEED;
}

export function advanceTraffic(world: Traffic, seed: number, s: number, tick: number): Traffic {
  const rows = world.rows;
  let expired = 0;
  while (expired < rows.length && trafficPosition(rows[expired]!, tick) < s - KEEP_BEHIND)
    expired++;
  if (expired === 0 && world.nextRow * ROW_SPACING > s + TRAFFIC_LOOKAHEAD) return world;
  const retained = rows.slice(expired);
  let nextRow = world.nextRow;
  while (nextRow * ROW_SPACING <= s + TRAFFIC_LOOKAHEAD && retained.length < MAX_TRAFFIC_ROWS) {
    // After a capacity stall, never create cars within the already visible foreground.
    const spawn =
      retained.length === 0 && nextRow === 1
        ? Math.max(s + ROW_SPACING, nextRow * ROW_SPACING)
        : s + TRAFFIC_LOOKAHEAD;
    retained.push({ s: spawn, tick, cars: trafficPattern(seed, nextRow) });
    nextRow++;
  }
  return { rows: retained, nextRow };
}
