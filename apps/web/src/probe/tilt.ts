export function screenRoll(beta: number, gamma: number, angle: number): number {
  const radians = (angle * Math.PI) / 180;
  return gamma * Math.cos(radians) + beta * Math.sin(radians);
}

/** Optional sensor experiment; stale/missing events always produce neutral. */
export class TiltProbe {
  private enabled = false;
  private lastAt = -Infinity;
  private raw = 0;
  private center = 0;
  private filtered = 0;
  private calibrating = true;
  private epoch = 0;
  readonly report = {
    supported: "DeviceOrientationEvent" in window,
    permission: "unrequested",
    samples: 0,
    rotations: 0,
    calibrations: 0,
  };
  private status: (message: string) => void;
  constructor(status: (message: string) => void) {
    this.status = status;
    window.addEventListener("deviceorientation", this.sample);
    screen.orientation?.addEventListener("change", this.rotate);
  }
  async enable() {
    const epoch = ++this.epoch;
    try {
      if (!isSecureContext || !this.report.supported)
        throw new Error("La inclinación requiere HTTPS y sensores compatibles. Usa el táctil.");
      const api = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
      const permission = api.requestPermission ? await api.requestPermission() : "granted";
      this.report.permission = permission;
      if (epoch !== this.epoch) return;
      if (permission !== "granted")
        throw new Error("Permiso denegado. El táctil sigue disponible.");
      this.enabled = true;
      this.calibrating = true;
      this.filtered = 0;
      this.status("Esperando sensores. Mantén el teléfono en posición cómoda.");
    } catch (error) {
      this.enabled = false;
      this.status(error instanceof Error ? error.message : "No se pudo activar. Usa el táctil.");
    }
  }
  private sample = (event: DeviceOrientationEvent) => {
    if (
      !this.enabled ||
      document.hidden ||
      event.beta === null ||
      event.gamma === null ||
      !Number.isFinite(event.beta) ||
      !Number.isFinite(event.gamma)
    )
      return;
    const now = performance.now();
    this.raw = screenRoll(event.beta, event.gamma, screen.orientation?.angle ?? 0);
    if (this.calibrating) {
      this.center = this.raw;
      this.calibrating = false;
      this.report.calibrations++;
    }
    const target = Math.max(-1, Math.min(1, (this.raw - this.center) / 30));
    const alpha = 1 - Math.exp(-Math.min(now - this.lastAt, 100) / 70);
    this.filtered += (target - this.filtered) * alpha;
    this.lastAt = now;
    this.report.samples++;
    if (this.report.samples === 1)
      this.status("Inclinación activa. Los botones de giro tienen prioridad.");
  };
  private rotate = () => {
    this.report.rotations++;
    this.calibrating = true;
    this.filtered = 0;
    this.lastAt = -Infinity;
    this.status("Pantalla girada: mantén posición para recalibrar.");
  };
  calibrate() {
    this.calibrating = true;
    this.filtered = 0;
  }
  get value() {
    return this.enabled && performance.now() - this.lastAt < 150 && Math.abs(this.filtered) > 0.05
      ? this.filtered
      : 0;
  }
  stop() {
    this.enabled = false;
    this.epoch++;
    this.filtered = 0;
    this.lastAt = -Infinity;
  }
  dispose() {
    this.stop();
    window.removeEventListener("deviceorientation", this.sample);
    screen.orientation?.removeEventListener("change", this.rotate);
  }
}
