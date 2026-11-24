import { GENERATOR_VERSION, RULES_VERSION, type Race, TICK_HZ } from "@qracer/game-core";

/** Voluntary local summary only. No input history, credentials or device IDs. */
export function runReport(race: Race) {
  return {
    schemaVersion: 1,
    mode: race.run.mode,
    seed: race.seed,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    category: race.run.category,
    assisted: race.run.assisted,
    seconds: race.tick / TICK_HZ,
    score: race.score,
    distance: Math.floor(race.driver.s),
    topSpeedKmh: race.topSpeed * 3.6,
    overtakes: race.overtakes,
    nearMisses: race.nearMisses,
    impacts: race.impacts,
    grazes: race.grazes,
    integrity: race.driver.integrity,
  };
}
