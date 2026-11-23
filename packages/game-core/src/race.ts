import { CAR_HALF_LENGTH, contactFor, sweptClearance } from "./collision.ts";
import { type DriveInput, type Driver, drive, driving, initialDriver, TICK_HZ } from "./driving.ts";
import { advanceTraffic, emptyTraffic, type Traffic, trafficPosition } from "./traffic.ts";

const COUNTDOWN = 3 * TICK_HZ;
const PROTECTION = 1.5 * TICK_HZ;
const COMBO_TIMEOUT = 5 * TICK_HZ;

export interface RaceEvent {
  readonly type: "graze" | "impact" | "overtake" | "near";
  readonly car: number;
}

type Encounter = "near" | "graze" | "contact" | "passed";

export interface Race {
  readonly phase: "countdown" | "racing" | "finished";
  readonly countdown: number;
  readonly tick: number;
  readonly seed: number;
  readonly driver: Driver;
  readonly traffic: Traffic;
  readonly encounters: ReadonlyMap<number, Encounter>;
  readonly protectedUntil: number;
  readonly comboUntil: number;
  readonly combo: number;
  readonly overtakes: number;
  readonly nearMisses: number;
  readonly bonus: number;
  readonly score: number;
  readonly topSpeed: number;
  readonly events: readonly RaceEvent[];
}

const noEvents: readonly RaceEvent[] = [];

export function createRace(seed: number = 310): Race {
  const driver = initialDriver();
  return {
    phase: "countdown",
    countdown: COUNTDOWN,
    tick: 0,
    seed: seed | 0,
    driver,
    traffic: advanceTraffic(emptyTraffic, seed, 0, 0),
    encounters: new Map(),
    protectedUntil: 0,
    comboUntil: 0,
    combo: 1,
    overtakes: 0,
    nearMisses: 0,
    bonus: 0,
    score: 0,
    topSpeed: 0,
    events: noEvents,
  };
}

export function stepRace(state: Race, input: DriveInput): Race {
  if (state.phase === "finished") return state;
  if (state.phase === "countdown") {
    const countdown = state.countdown - 1;
    return { ...state, countdown, phase: countdown === 0 ? "racing" : "countdown" };
  }
  const tick = state.tick + 1;
  const before = state.driver;
  const motion = drive(before, input, driving, tick >= state.protectedUntil);
  let { integrity, speed } = motion;
  let { protectedUntil, bonus, overtakes, nearMisses, comboUntil } = state;
  let combo = tick >= comboUntil ? 1 : state.combo;
  let changes: Map<number, Encounter> | undefined;
  let events: RaceEvent[] | undefined;
  const remember = (id: number, value: Encounter) => {
    changes ??= new Map(state.encounters);
    changes.set(id, value);
  };
  const emit = (type: RaceEvent["type"], car: number) => {
    events ??= [];
    events.push({ type, car });
  };

  for (const row of state.traffic.rows) {
    const oldS = before.s - trafficPosition(row, state.tick);
    const newS = motion.s - trafficPosition(row, tick);
    if (newS < -2 * CAR_HALF_LENGTH || oldS > 2 * CAR_HALF_LENGTH) continue;
    for (const car of row.cars) {
      const seen = state.encounters.get(car.id);
      if (seen === "passed") continue;
      const clearance = sweptClearance(oldS, newS, before.d - car.d, motion.d - car.d);
      const contact = contactFor(clearance, driving.playerHalfWidth);
      if (contact === "impact" && seen !== "contact") {
        remember(car.id, "contact");
        if (integrity > 0 && tick >= protectedUntil) {
          integrity--;
          protectedUntil = tick + PROTECTION;
          speed = Math.max(driving.minimum, speed * 0.62);
          combo = 1;
          comboUntil = 0;
          emit("impact", car.id);
        }
      } else if (contact === "graze" && seen !== "contact" && seen !== "graze") {
        remember(car.id, "graze");
        speed = Math.max(driving.minimum, speed * 0.92);
        emit("graze", car.id);
      } else if (contact === "near" && !seen) {
        remember(car.id, "near");
      }
      if (newS > 2 * CAR_HALF_LENGTH) {
        const final = changes?.get(car.id) ?? seen;
        if (final !== "contact" && final !== "graze") {
          overtakes++;
          emit("overtake", car.id);
          if (final === "near") {
            nearMisses++;
            bonus += 50 * combo;
            combo = Math.min(5, combo + 1);
            comboUntil = tick + COMBO_TIMEOUT;
            emit("near", car.id);
          }
        }
        remember(car.id, "passed");
      }
    }
  }

  const traffic = advanceTraffic(state.traffic, state.seed, motion.s, tick);
  let encounters = changes ?? state.encounters;
  if (traffic !== state.traffic && encounters.size > 0) {
    const active = new Map<number, Encounter>();
    for (const row of traffic.rows)
      for (const car of row.cars) {
        const value = encounters.get(car.id);
        if (value) active.set(car.id, value);
      }
    encounters = active;
  }

  return {
    ...state,
    phase: integrity === 0 ? "finished" : state.phase,
    tick,
    driver: { ...motion, speed, integrity },
    traffic,
    encounters,
    protectedUntil,
    comboUntil,
    combo,
    overtakes,
    nearMisses,
    bonus,
    score: Math.floor(motion.s) + 100 * overtakes + bonus,
    topSpeed: Math.max(state.topSpeed, motion.speed),
    events: events ?? noEvents,
  };
}
