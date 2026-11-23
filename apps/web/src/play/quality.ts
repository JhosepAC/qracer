export const qualities = {
  low: { width: 1280, height: 720, dpr: 1, particles: 24, shadow: 0, trafficRange: 170 },
  balanced: { width: 1920, height: 1080, dpr: 1.25, particles: 48, shadow: 512, trafficRange: 212 },
  high: { width: 1920, height: 1080, dpr: 1.5, particles: 72, shadow: 1024, trafficRange: 232 },
} as const;
export type Quality = keyof typeof qualities;
const key = "qracer.graphics.quality";

export function isQuality(value: string | null): value is Quality {
  return value === "low" || value === "balanced" || value === "high";
}

export function loadQuality(): Quality {
  try {
    const value = localStorage.getItem(key);
    if (isQuality(value)) return value;
  } catch {
    /* Storage is optional. */
  }
  return "balanced";
}

export function saveQuality(value: Quality) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The selection still applies to this page. */
  }
}
