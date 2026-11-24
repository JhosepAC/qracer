import { driving, type DrivingConfig, ROAD_HALF_WIDTH } from "./driving.ts";

export const REACTION_SECONDS = 2.15;
export interface Occupancy {
  from: number;
  to: number;
  halfWidth: number;
}

/** Conservative steering bound: cancel adverse momentum, accelerate and cross.
 * All motion completes before the earliest possible longitudinal contact.
 * The reserved corridor then remains clear throughout every announced maneuver. */
export function validateRoute(
  ahead: number,
  safe: number,
  occupancy: readonly Occupancy[],
  config: DrivingConfig = driving,
) {
  const edge = ROAD_HALF_WIDTH - config.playerHalfWidth;
  const arrival = (ahead - 5) / config.boostMaximum;
  let maneuver = 0;
  for (const d of [-edge, 0, edge])
    for (const lateral of [-config.lateralSpeed, 0, config.lateralSpeed]) {
      const adverseDrift = (lateral * lateral) / (2 * config.lateralAcceleration);
      const bound =
        (Math.abs(safe - d) + adverseDrift) / config.lateralSpeed +
        (Math.abs(lateral) + config.lateralSpeed) / config.lateralAcceleration;
      maneuver = Math.max(maneuver, bound);
    }
  const corridor = occupancy.every(({ from, to, halfWidth }) => {
    const low = Math.min(from, to) - halfWidth - config.playerHalfWidth - 0.25;
    const high = Math.max(from, to) + halfWidth + config.playerHalfWidth + 0.25;
    return safe < low || safe > high;
  });
  return {
    valid: corridor && arrival >= REACTION_SECONDS + maneuver,
    arrival,
    required: REACTION_SECONDS + maneuver,
    safe,
  };
}

export function difficultyAt(distance: number, practice = false) {
  const level = practice ? 0 : Math.min(1, Math.max(0, distance) / 10000);
  return {
    level,
    spacing: 190 - 65 * level,
    moving: level >= 0.15,
    hazardEvery: level < 0.3 ? 5 : 4,
  };
}
