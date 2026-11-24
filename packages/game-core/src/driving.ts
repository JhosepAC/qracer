export const RULES_VERSION = 2;
export const TICK_HZ = 60;
export const STEP_SECONDS = 1 / TICK_HZ;
export const ROAD_HALF_WIDTH = 6;

export interface DriveInput {
  readonly steer: number;
  readonly throttle: number;
  readonly brake: number;
  readonly boost: boolean;
}

export const neutralInput: DriveInput = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  boost: false,
});

export interface DrivingConfig {
  readonly cruise: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly boostMaximum: number;
  readonly acceleration: number;
  readonly brakeRate: number;
  readonly coastRate: number;
  readonly lateralSpeed: number;
  readonly lateralAcceleration: number;
  readonly playerHalfWidth: number;
  readonly integrity: number;
  readonly nitroSeconds: number;
  readonly rechargePerSecond: number;
}

export const driving: DrivingConfig = Object.freeze({
  cruise: 80 / 3.6,
  minimum: 50 / 3.6,
  maximum: 180 / 3.6,
  boostMaximum: 200 / 3.6,
  acceleration: 9,
  brakeRate: 19,
  coastRate: 5,
  lateralSpeed: 7,
  lateralAcceleration: 20,
  playerHalfWidth: 0.95,
  integrity: 3,
  nitroSeconds: 3,
  rechargePerSecond: 0.15,
});

export interface Driver {
  readonly s: number;
  readonly d: number;
  readonly speed: number;
  readonly lateral: number;
  readonly nitro: number;
  readonly integrity: number;
  readonly boosting: boolean;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function axis(value: number, low: number) {
  return Number.isFinite(value) ? clamp(value, low, 1) : 0;
}

function approach(from: number, to: number, amount: number) {
  return from + clamp(to - from, -amount, amount);
}

export function initialDriver(config = driving): Driver {
  return {
    s: 0,
    d: 0,
    speed: config.cruise,
    lateral: 0,
    nitro: config.nitroSeconds,
    integrity: config.integrity,
    boosting: false,
  };
}

export function drive(state: Driver, input: DriveInput, config = driving, clean = true): Driver {
  const throttle = axis(input.throttle, 0);
  const brake = axis(input.brake, 0);
  const boost = input.boost === true && brake === 0 && state.nitro >= STEP_SECONDS;
  const target =
    brake > 0
      ? config.cruise - brake * (config.cruise - config.minimum)
      : boost
        ? config.boostMaximum
        : config.cruise + throttle * (config.maximum - config.cruise);
  const rate =
    brake > 0
      ? config.brakeRate
      : target > state.speed
        ? config.acceleration * (boost ? 1.8 : 1)
        : config.coastRate;
  const speed = approach(state.speed, target, rate * STEP_SECONDS);
  const lateral = approach(
    state.lateral,
    axis(input.steer, -1) * config.lateralSpeed,
    config.lateralAcceleration * STEP_SECONDS,
  );
  const limit = ROAD_HALF_WIDTH - config.playerHalfWidth;
  const nextD = state.d + lateral * STEP_SECONDS;
  const d = clamp(nextD, -limit, limit);
  const nitro = clamp(
    state.nitro +
      (boost ? -1 : clean && !input.boost ? config.rechargePerSecond : 0) * STEP_SECONDS,
    0,
    config.nitroSeconds,
  );
  return {
    ...state,
    s: state.s + speed * STEP_SECONDS,
    d,
    lateral: d === nextD ? lateral : 0,
    speed,
    nitro,
    boosting: boost,
  };
}
