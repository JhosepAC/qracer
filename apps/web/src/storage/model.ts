import {
  MODES,
  RULES_VERSION,
  GENERATOR_VERSION,
  type Mode,
  type Progress,
  type Race,
  emptyProgress,
} from "@qracer/game-core";

/** getRandomValues also works on the local HTTP edition. This is not an auth token. */
export const newRunId = () => crypto.getRandomValues(new Uint32Array(4)).join("-");

export const MAX_IMPORT = 1024 * 1024;
export type StorageStatus = "saved" | "memory" | "corrupt" | "future";
export class DataFault extends Error {
  readonly reason: "corrupt" | "future";
  constructor(reason: "corrupt" | "future") {
    super(reason);
    this.reason = reason;
  }
}
export interface Summary {
  schemaVersion: 1;
  id: string;
  category: string;
  mode: Mode;
  seed: number;
  rulesVersion: number;
  generatorVersion: number;
  assisted: boolean;
  score: number;
  distance: number;
  topSpeed: number;
  seconds: number;
  overtakes: number;
  nearMisses: number;
  ended: number;
}
export interface SaveData {
  schemaVersion: 2;
  progress: Progress;
  history: Summary[];
}
export const freshData = (): SaveData => ({
  schemaVersion: 2,
  progress: { ...emptyProgress, records: {}, recent: [] },
  history: [],
});
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export const bounded = (value: unknown, max = 1e12, integer = true): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max &&
  (!integer || Number.isSafeInteger(value));
export function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new DataFault("corrupt");
}
export function categoryInfo(value: unknown) {
  if (typeof value !== "string" || value.length > 100) return;
  const m = value.match(
    /^(infinite|practice|time-trial|daily)\/(-?\d{1,11})\/(\d{1,3})\/(\d{1,3})\/(\d{1,10})\/(standard|assisted)$/,
  );
  if (
    !m ||
    Number(m[2]) < -2147483648 ||
    Number(m[2]) > 2147483647 ||
    Number(m[3]) < 1 ||
    Number(m[4]) < 1 ||
    Number(m[5]) > 4294967295
  )
    return;
  return {
    mode: m[1] as Mode,
    seed: Number(m[2]),
    rulesVersion: Number(m[3]),
    generatorVersion: Number(m[4]),
    assisted: m[6] === "assisted",
  };
}
const idValid = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
export function readProgress(value: unknown): Progress {
  if (!object(value)) throw new DataFault("corrupt");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > 1)
    throw new DataFault("future");
  fields(value, ["schemaVersion", "distance", "overtakes", "nearMisses", "recent", "records"]);
  if (
    value.schemaVersion !== 1 ||
    !bounded(value.distance) ||
    !bounded(value.overtakes) ||
    !bounded(value.nearMisses) ||
    !Array.isArray(value.recent) ||
    value.recent.length > 20 ||
    !value.recent.every(idValid) ||
    new Set(value.recent).size !== value.recent.length ||
    !object(value.records) ||
    Object.keys(value.records).length > 100
  )
    throw new DataFault("corrupt");
  const records: Record<string, number> = {};
  for (const [key, score] of Object.entries(value.records)) {
    if (!categoryInfo(key) || !bounded(score)) throw new DataFault("corrupt");
    records[key] = score;
  }
  return {
    schemaVersion: 1,
    distance: value.distance,
    overtakes: value.overtakes,
    nearMisses: value.nearMisses,
    recent: [...value.recent],
    records,
  };
}
export function readSummary(value: unknown): Summary {
  if (!object(value)) throw new DataFault("corrupt");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > 1)
    throw new DataFault("future");
  fields(value, [
    "schemaVersion",
    "id",
    "category",
    "mode",
    "seed",
    "rulesVersion",
    "generatorVersion",
    "assisted",
    "score",
    "distance",
    "topSpeed",
    "seconds",
    "overtakes",
    "nearMisses",
    "ended",
  ]);
  const info = categoryInfo(value.category);
  if (
    value.schemaVersion !== 1 ||
    !idValid(value.id) ||
    !info ||
    !MODES.includes(value.mode as Mode) ||
    Object.entries(info).some(([key, v]) => value[key] !== v) ||
    !["score", "distance", "overtakes", "nearMisses"].every((k) => bounded(value[k])) ||
    !bounded(value.topSpeed, 1000, false) ||
    !bounded(value.seconds, 1e8, false) ||
    !bounded(value.ended, 4102444800000)
  )
    throw new DataFault("corrupt");
  return {
    schemaVersion: 1,
    id: value.id,
    category: String(value.category),
    ...info,
    score: Number(value.score),
    distance: Number(value.distance),
    topSpeed: Number(value.topSpeed),
    seconds: Number(value.seconds),
    overtakes: Number(value.overtakes),
    nearMisses: Number(value.nearMisses),
    ended: Number(value.ended),
  };
}
export function readData(value: unknown): SaveData {
  if (value === undefined) return freshData();
  if (!object(value)) throw new DataFault("corrupt");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > 2)
    throw new DataFault("future");
  // Supported v1 was the plain Progress snapshot. Upgrade without dropping scores.
  if (value.schemaVersion === 1)
    return { schemaVersion: 2, progress: readProgress(value), history: [] };
  fields(value, ["schemaVersion", "progress", "history"]);
  if (value.schemaVersion !== 2 || !Array.isArray(value.history) || value.history.length > 20)
    throw new DataFault("corrupt");
  const history = value.history.map(readSummary);
  if (new Set(history.map((row) => row.id)).size !== history.length) throw new DataFault("corrupt");
  return { schemaVersion: 2, progress: readProgress(value.progress), history };
}
export function summarize(id: string, race: Race, ended = Date.now()): Summary {
  return readSummary({
    schemaVersion: 1,
    id,
    category: race.run.category,
    mode: race.run.mode,
    seed: race.seed,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    assisted: race.run.assisted,
    score: race.score,
    distance: Math.floor(race.driver.s),
    topSpeed: race.topSpeed * 3.6,
    seconds: race.tick / 60,
    overtakes: race.overtakes,
    nearMisses: race.nearMisses,
    ended,
  });
}
export function addResult(data: SaveData, row: Summary): SaveData {
  const p = data.progress;
  if (p.recent.includes(row.id)) return data;
  const competitive = row.mode !== "practice";
  const records = { ...p.records };
  if (competitive) {
    const best = Math.max(records[row.category] ?? 0, row.score);
    delete records[row.category];
    records[row.category] = best;
    const keys = Object.keys(records);
    const primary = keys.reduce(
      (a, b) => ((records[a] ?? 0) >= (records[b] ?? 0) ? a : b),
      keys[0] ?? "",
    );
    for (const key of keys.filter((k) => k !== primary).slice(0, Math.max(0, keys.length - 100)))
      delete records[key];
  }
  return {
    schemaVersion: 2,
    progress: {
      schemaVersion: 1,
      distance: Math.min(1e12, p.distance + (competitive ? row.distance : 0)),
      overtakes: Math.min(1e12, p.overtakes + (competitive ? row.overtakes : 0)),
      nearMisses: Math.min(1e12, p.nearMisses + (competitive ? row.nearMisses : 0)),
      records,
      recent: [...p.recent.slice(-19), row.id],
    },
    history: [row, ...data.history].slice(0, 20),
  };
}
