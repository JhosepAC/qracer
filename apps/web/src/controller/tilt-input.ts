import { screenRoll } from "../probe/tilt.ts";

const STALE_MS = 150;
export const angularDelta = (current: number, center: number) =>
  ((current - center + 540) % 360) - 180;

export class TiltFilter {
  private center?: number;
  private last = -Infinity;
  private filtered = 0;

  reset() {
    delete this.center;
    this.last = -Infinity;
    this.filtered = 0;
  }

  update(roll: number, now: number) {
    if (!Number.isFinite(roll)) return;
    if (this.center === undefined) this.center = roll;
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
}

export class TiltInput {
  readonly filter = new TiltFilter();
  active = false;
  samples = 0;
  rotations = 0;
  private knownAt = 0;
  private resetAt = 0;
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
      this.filter.update(screenRoll(beta, gamma, angle), performance.now());
      this.samples++;
      if (this.samples === this.knownAt + 1)
        this.onStatus("Inclinación activa. El táctil tiene prioridad.");
    });
    const rotate = () => {
      this.rotations++;
      this.center();
      if (this.active) this.onStatus("Pantalla girada. Mantén el móvil centrado.");
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
      this.onStatus("Mantén el móvil en posición cómoda para centrarlo.");
    } catch (error) {
      if (attempt !== this.attempts) return;
      this.stop();
      this.onStatus(
        error instanceof Error ? error.message : "Sensores no disponibles. Usa el táctil.",
      );
    }
  }

  center() {
    this.knownAt = this.samples;
    this.resetAt = performance.now();
    this.filter.reset();
  }

  stop() {
    this.active = false;
    this.attempts++;
    this.center();
  }

  value(now: number) {
    if (!this.active) return 0;
    if (!this.filter.fresh(now) && now - this.resetAt > 1000) {
      this.stop();
      this.onStatus("El sensor dejó de responder. El mando sigue en táctil.");
      return 0;
    }
    return this.filter.value(now);
  }
}
