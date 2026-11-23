import { screenRoll } from "../probe/tilt.ts";

const STALE_MS = 150;
export const angularDelta = (current: number, center: number) =>
  ((current - center + 540) % 360) - 180;

export class TiltFilter {
  private center?: number;
  private reference = 0;
  private stable = 0;
  private last = -Infinity;
  private filtered = 0;

  reset() {
    delete this.center;
    this.stable = 0;
    this.last = -Infinity;
    this.filtered = 0;
  }

  update(roll: number, now: number) {
    if (!Number.isFinite(roll)) return;
    if (!this.fresh(now)) this.reset();
    if (this.center === undefined) {
      if (!this.stable || Math.abs(angularDelta(roll, this.reference)) > 3) {
        this.reference = roll;
        this.stable = 0;
      }
      this.stable++;
      if (this.stable === 4) this.center = roll;
      this.last = now;
      return;
    }
    const delta = angularDelta(roll, this.center);
    const target = Math.sign(delta) * Math.min(1, Math.max(0, (Math.abs(delta) - 3) / 22));
    const time = Math.max(0, Math.min(100, now - this.last));
    this.filtered += (target - this.filtered) * (1 - Math.exp(-time / 70));
    this.last = now;
  }

  value(now: number) {
    return this.fresh(now) ? this.filtered : 0;
  }

  fresh(now: number) {
    return now - this.last < STALE_MS;
  }

  get calibrated() {
    return this.center !== undefined;
  }
}

export class TiltInput {
  readonly filter = new TiltFilter();
  active = false;
  samples = 0;
  rotations = 0;
  private lastSample = 0;
  private attempts = 0;
  private readonly onStatus: (status: string) => void;

  constructor(onStatus: (status: string) => void) {
    this.onStatus = onStatus;
    window.addEventListener("deviceorientation", (event) => {
      const { beta, gamma } = event;
      if (
        !this.active ||
        document.hidden ||
        beta === null ||
        gamma === null ||
        !Number.isFinite(beta) ||
        !Number.isFinite(gamma)
      )
        return;
      const legacy = (window as Window & { orientation?: number }).orientation;
      const angle = screen.orientation?.angle ?? legacy ?? 0;
      const now = performance.now();
      const wasCalibrated = this.filter.calibrated && this.filter.fresh(now);
      this.filter.update(screenRoll(beta, gamma, angle), now);
      this.lastSample = now;
      this.samples++;
      if (!wasCalibrated && this.filter.calibrated)
        this.onStatus("Inclinación activa. Inclina el móvil para girar.");
    });
    const rotate = () => {
      this.rotations++;
      this.center();
    };
    if (screen.orientation) screen.orientation.addEventListener("change", rotate);
    else window.addEventListener("orientationchange", rotate);
  }

  async enable() {
    const attempt = ++this.attempts;
    try {
      if (!isSecureContext || !("DeviceOrientationEvent" in window))
        throw new Error(
          "La inclinación requiere HTTPS y sensores compatibles. Puedes seguir con táctil.",
        );
      const api = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
      const permission = api.requestPermission ? await api.requestPermission() : "granted";
      if (attempt !== this.attempts) return;
      if (permission !== "granted") throw new Error("Permiso denegado. El mando sigue en táctil.");
      this.active = true;
      this.center();
    } catch (error) {
      if (attempt !== this.attempts) return;
      this.stop();
      this.onStatus(
        error instanceof Error ? error.message : "Sensores no disponibles. Usa el táctil.",
      );
    }
  }

  center() {
    this.lastSample = performance.now();
    this.filter.reset();
    if (this.active) this.onStatus("Mantén el móvil quieto en posición cómoda para centrarlo.");
  }

  stop() {
    this.active = false;
    this.attempts++;
    this.center();
  }

  value(now: number) {
    if (!this.active) return 0;
    if (now - this.lastSample > 1000) {
      this.stop();
      this.onStatus("El sensor dejó de responder. El mando sigue en táctil.");
      return 0;
    }
    return this.filter.value(now);
  }
}
