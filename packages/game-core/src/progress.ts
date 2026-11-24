import type { Race } from "./race.ts";

export const PAINTS = ["Solar", "Glaciar", "Coral", "Jade", "Violeta", "Grafito"] as const;
export interface Progress {
  readonly schemaVersion: 1;
  readonly distance: number;
  readonly overtakes: number;
  readonly nearMisses: number;
  readonly recent: readonly string[];
  readonly records: Readonly<Record<string, number>>;
}
export const emptyProgress: Progress = Object.freeze({
  schemaVersion: 1,
  distance: 0,
  overtakes: 0,
  nearMisses: 0,
  recent: [],
  records: {},
});

export function unlockedPaints(progress: Progress) {
  return [
    true,
    progress.distance >= 1000,
    progress.overtakes >= 10,
    progress.nearMisses >= 3,
    progress.distance >= 5000,
    progress.distance >= 5000 && progress.overtakes >= 10 && progress.nearMisses >= 3,
  ];
}

export function objectives(progress: Progress) {
  return [
    { label: "Explorador", current: progress.distance, target: 5000 },
    { label: "Adelantamientos limpios", current: progress.overtakes, target: 10 },
    { label: "Al límite", current: progress.nearMisses, target: 3 },
  ];
}

/** F08 keeps progress in memory. F10 owns the transactional persistent adapter. */
export function awardRun(progress: Progress, id: string, race: Race): Progress {
  if (race.phase !== "finished" || !race.run.competitive || progress.recent.includes(id))
    return progress;
  const records = { ...progress.records };
  records[race.run.category] = Math.max(records[race.run.category] ?? 0, race.score);
  const categories = Object.keys(records);
  for (const key of categories.slice(0, Math.max(0, categories.length - 100))) delete records[key];
  return {
    schemaVersion: 1,
    distance: progress.distance + Math.floor(race.driver.s),
    overtakes: progress.overtakes + race.overtakes,
    nearMisses: progress.nearMisses + race.nearMisses,
    recent: [...progress.recent.slice(-19), id],
    records,
  };
}
