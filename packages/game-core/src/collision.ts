export const CAR_HALF_LENGTH = 2.1;
export const TRAFFIC_HALF_WIDTH = 0.95;
const GRAZE_DEPTH = 0.24;
const NEAR_MARGIN = 0.55;

/** Minimum lateral separation while longitudinal footprints overlap during this tick. */
export function sweptClearance(
  previousS: number,
  nextS: number,
  previousD: number,
  nextD: number,
): number {
  const extent = CAR_HALF_LENGTH * 2;
  const speed = nextS - previousS;
  if (speed === 0 && Math.abs(previousS) > extent) return Infinity;
  const enter = speed === 0 ? 0 : (-extent - previousS) / speed;
  const exit = speed === 0 ? 1 : (extent - previousS) / speed;
  const from = Math.max(0, Math.min(enter, exit));
  const to = Math.min(1, Math.max(enter, exit));
  if (to < from) return Infinity;
  const drift = nextD - previousD;
  const left = previousD + drift * from;
  const right = previousD + drift * to;
  return left * right <= 0 ? 0 : Math.min(Math.abs(left), Math.abs(right));
}

export function contactFor(clearance: number, playerHalfWidth: number) {
  const penetration = playerHalfWidth + TRAFFIC_HALF_WIDTH - clearance;
  if (penetration >= GRAZE_DEPTH) return "impact";
  if (penetration >= 0) return "graze";
  if (penetration >= -NEAR_MARGIN) return "near";
  return "clear";
}
