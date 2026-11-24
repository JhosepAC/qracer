import { RULES_VERSION, TICK_HZ, type DrivingConfig } from "./driving.ts";
import { GENERATOR_VERSION } from "./traffic.ts";

export const MODES = ["infinite", "practice", "time-trial", "daily"] as const;
export type Mode = (typeof MODES)[number];
export interface RaceOptions {
  mode?: Mode;
  assisted?: boolean;
  date?: Date;
}
export interface Run {
  readonly mode: Mode;
  readonly seed: number;
  readonly category: string;
  readonly limit: number;
  readonly competitive: boolean;
  readonly assisted: boolean;
  readonly day?: string;
}

export function hashText(text: string) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function createRun(seed: number, config: DrivingConfig, options: RaceOptions = {}): Run {
  const mode = MODES.includes(options.mode as Mode) ? (options.mode ?? "infinite") : "infinite";
  const assisted = options.assisted === true;
  const day =
    mode === "daily" ? (options.date ?? new Date()).toISOString().slice(0, 10) : undefined;
  const fingerprint = hashText(JSON.stringify(config));
  const version = `${RULES_VERSION}/${GENERATOR_VERSION}/${fingerprint}`;
  const actualSeed = day ? hashText(`${day}/${version}`) | 0 : seed | 0;
  return Object.freeze({
    mode,
    seed: actualSeed,
    assisted,
    category: `${mode}/${actualSeed}/${version}/${assisted ? "assisted" : "standard"}`,
    limit: mode === "daily" || mode === "time-trial" ? 120 * TICK_HZ : Infinity,
    competitive: mode !== "practice",
    ...(day ? { day } : {}),
  });
}
