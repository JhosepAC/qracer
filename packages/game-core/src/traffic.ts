import { difficultyAt, validateRoute, REACTION_SECONDS } from "./reachability.ts";
import { STEP_SECONDS, TICK_HZ, driving, type DrivingConfig } from "./driving.ts";
import { laneCenters } from "./road.ts";

export const GENERATOR_VERSION = 3;
export const ROW_SPACING = 160;
export const TRAFFIC_LOOKAHEAD = 360;
export const TRAFFIC_SPEED = 10;
const KEEP_BEHIND = 28;
export const MAX_TRAFFIC_ROWS = 9;
export const MAX_TRAFFIC = MAX_TRAFFIC_ROWS * 2;

export interface TrafficCar {
  readonly id: number;
  readonly d: number;
  readonly paint: number;
  readonly kind?: 0 | 1 | 2;
  readonly targetD?: number;
  readonly moveAt?: number;
}

export interface TrafficRow {
  readonly s: number;
  readonly tick: number;
  readonly cars: readonly TrafficCar[];
  readonly hazard?: "cones" | "barrier";
}

export interface Traffic {
  readonly nextRow: number;
  readonly rows: readonly TrafficRow[];
  readonly nextSpawn?: number;
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
  const safeLane = openLane(seed);
  const mask = randomWord(seed, row, 1) & 7;
  const safeMask = 1 << ((safeLane + 1 + (row % 2)) % 3);
  const chosen = mask === 0 || mask & (1 << safeLane) ? safeMask : mask;
  return laneCenters.flatMap((d, lane) =>
    chosen & (1 << lane)
      ? [
          {
            id: row * 3 + lane,
            d,
            paint: randomWord(seed, row, 2 + lane) % 6,
            kind: (randomWord(seed, row, 9 + lane) % 3) as 0 | 1 | 2,
          },
        ]
      : [],
  );
}

export function trafficPosition(row: TrafficRow, tick: number): number {
  return row.hazard ? row.s : row.s + (tick - row.tick) * STEP_SECONDS * TRAFFIC_SPEED;
}

export function trafficLateral(car: TrafficCar, tick: number) {
  if (car.targetD === undefined || car.moveAt === undefined) return car.d;
  const t = Math.max(0, Math.min(1, (tick - car.moveAt) / (2 * TICK_HZ)));
  return car.d + (car.targetD - car.d) * t * t * (3 - 2 * t);
}

export function advanceTraffic(
  world: Traffic,
  seed: number,
  s: number,
  tick: number,
  practice = false,
  config: DrivingConfig = driving,
): Traffic {
  let rows = world.rows;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || row.hazard || trafficPosition(row, tick) - s > 160) continue;
    if (!row.cars.some((car) => car.targetD !== undefined && car.moveAt === undefined)) continue;
    const updated = {
      ...row,
      cars: row.cars.map((car) =>
        car.targetD !== undefined && car.moveAt === undefined
          ? { ...car, moveAt: tick + Math.ceil(REACTION_SECONDS * TICK_HZ) }
          : car,
      ),
    };
    rows = rows.map((value, i) => (i === index ? updated : value));
  }
  const nextSpawn = world.nextSpawn ?? 0;
  const onRoad = (row: TrafficRow) => trafficPosition(row, tick) >= s - KEEP_BEHIND;
  if (nextSpawn > s + TRAFFIC_LOOKAHEAD && rows.every(onRoad))
    return rows === world.rows ? world : { ...world, rows };
  const retained = rows.filter(onRoad);
  if (nextSpawn > s + TRAFFIC_LOOKAHEAD || retained.length >= MAX_TRAFFIC_ROWS)
    return { ...world, rows: retained };
  const row = world.nextRow;
  const difficulty = difficultyAt(s, practice);
  let cars = trafficPattern(seed, row);
  const hazard =
    row % difficulty.hazardEvery === 3
      ? row % 8 === 3
        ? ("cones" as const)
        : ("barrier" as const)
      : undefined;
  if (hazard) cars = cars.slice(0, 1);
  const safe = laneCenters[openLane(seed)] ?? 0;
  const free = laneCenters.filter((d) => d !== safe);
  if (
    !hazard &&
    difficulty.moving &&
    cars.length === 1 &&
    free.length === 2 &&
    Math.abs((free[0] ?? 0) - (free[1] ?? 0)) === 4
  ) {
    const car = cars[0];
    if (car) cars = [{ ...car, targetD: free.find((d) => d !== car.d) ?? car.d }];
  }
  const valid = validateRoute(
    TRAFFIC_LOOKAHEAD,
    safe,
    cars.map((car) => ({ from: car.d, to: car.targetD ?? car.d, halfWidth: hazard ? 0.8 : 0.95 })),
    config,
  ).valid;
  // One bounded candidate, then an empty safe fallback. Never retry random generation.
  if (!valid) cars = [];
  retained.push({ s: s + TRAFFIC_LOOKAHEAD, tick, cars, ...(hazard ? { hazard } : {}) });
  return {
    rows: retained,
    nextRow: row + 1,
    nextSpawn: s + TRAFFIC_LOOKAHEAD + difficulty.spacing,
  };
}
