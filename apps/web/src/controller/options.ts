import { transportDiagnostic } from "../session/diagnostic.ts";
import type { DriveFrame } from "@qracer/session-core/wire";
import type { DriveChannel } from "../session/drive-channel.ts";
import { TiltInput } from "./tilt-input.ts";

export const steeringMarkup = `
<div class="handset-modes" role="group" aria-label="Modo de dirección">
  <button type="button" id="activate-tilt">Activar inclinación</button>
  <button type="button" id="touch-only">Usar táctil</button>
  <button type="button" id="center-tilt" hidden>Centrar inclinación</button>
  <p id="tilt-status" role="status">Inclina el móvil para girar o usa el volante táctil.</p>
</div>`;

export const optionsMarkup = `
<p id="mobile-feedback" class="mobile-feedback" aria-live="polite" hidden></p>
<details class="handset-options"><summary>Ajustes y diagnóstico</summary>
  <div class="handset-options-grid">
    <label for="turn-side">Lado de los pedales</label><select id="turn-side"><option value="right">Derecha</option><option value="left">Izquierda</option></select>
    <label for="turn-sensitivity">Sensibilidad de giro</label><input id="turn-sensitivity" type="range" min="0.5" max="1.8" step="0.1" value="1">
    <label><input id="turn-invert" type="checkbox"> Invertir volante e inclinación</label>
    <label><input id="drive-assist" type="checkbox"> Conducción asistida</label>
    <label><input id="drive-haptics" type="checkbox"> Vibración</label>
    <label><input id="drive-awake" type="checkbox"> Mantener pantalla activa</label>
    <p id="wake-status"></p>
    <button type="button" id="drive-diagnostic">Guardar diagnóstico</button>
  </div>
</details>`;

const key = "qracer.controller.settings.v1";
export const feedbackLabels = { impact: "Impacto", near: "¡Por poco!", boost: "Nitro" };
export const feedbackPulse = { impact: 55, near: 18, boost: 28 };

export class FeedbackWindow {
  private lastId = -1;
  private lastAt = -Infinity;

  reset() {
    this.lastId = -1;
    this.lastAt = -Infinity;
  }

  accept(id: number, captured: number | undefined, now: number) {
    if (id <= this.lastId || captured === undefined) return false;
    this.lastId = id;
    if (now - this.lastAt < 180) return false;
    this.lastAt = now;
    return true;
  }
}

export function mountOptions(shell: HTMLElement, channel: DriveChannel, clearTouch: () => void) {
  function field<T extends HTMLElement>(id: string): T {
    const node = shell.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing #${id}`);
    return node;
  }
  const side = field<HTMLSelectElement>("turn-side");
  const sensitivity = field<HTMLInputElement>("turn-sensitivity");
  const invert = field<HTMLInputElement>("turn-invert");
  const assist = field<HTMLInputElement>("drive-assist");
  const vibration = field<HTMLInputElement>("drive-haptics");
  const awake = field<HTMLInputElement>("drive-awake");
  const wakeStatus = field("wake-status");
  const tiltStatus = field("tilt-status");
  const flash = field("mobile-feedback");
  const activate = field<HTMLButtonElement>("activate-tilt");
  const center = field<HTMLButtonElement>("center-tilt");
  const tiltAvailable = isSecureContext && "DeviceOrientationEvent" in window;
  activate.disabled = !tiltAvailable;
  if (!tiltAvailable)
    tiltStatus.textContent = isSecureContext
      ? "Sensor de inclinación no disponible. El táctil está listo."
      : "La inclinación requiere HTTPS. El táctil está listo.";
  const tilt = new TiltInput((message) => {
    tiltStatus.textContent = message;
    center.hidden = !tilt.active;
    activate.hidden = tilt.active;
  });
  const feedback = new FeedbackWindow();
  let lock: WakeLockSentinel | undefined;
  let pendingLock = false;
  let linked = false;
  let flashTimer = 0;
  let packets = 0;
  let feedbackCount = 0;

  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    side.value = stored?.side === "left" ? "left" : "right";
    if (
      typeof stored?.sensitivity === "number" &&
      stored.sensitivity >= 0.5 &&
      stored.sensitivity <= 1.8
    )
      sensitivity.value = String(stored.sensitivity);
    invert.checked = stored?.invert === true;
    assist.checked = stored?.assist === true;
    vibration.checked = stored?.vibration === true;
  } catch {
    /* Preferences are optional. */
  }

  function save() {
    shell.dataset.side = side.value;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          side: side.value,
          sensitivity: sensitivity.valueAsNumber,
          invert: invert.checked,
          assist: assist.checked,
          vibration: vibration.checked,
        }),
      );
    } catch {
      /* Continue using preferences in this tab. */
    }
  }

  async function wake() {
    if (!linked || document.hidden || !awake.checked) {
      void lock?.release().catch(() => {});
      lock = undefined;
      return;
    }
    if (!navigator.wakeLock) {
      wakeStatus.textContent = "Esta función requiere HTTPS y un navegador compatible.";
      return;
    }
    if (lock || pendingLock) return;
    pendingLock = true;
    try {
      const acquired = await navigator.wakeLock.request("screen");
      if (!linked || document.hidden || !awake.checked) await acquired.release();
      else {
        lock = acquired;
        wakeStatus.textContent = "Pantalla activa.";
        acquired.addEventListener(
          "release",
          () => {
            if (lock === acquired) lock = undefined;
            wakeStatus.textContent = "Protección de pantalla liberada.";
          },
          { once: true },
        );
      }
    } catch {
      wakeStatus.textContent = "No se pudo mantener la pantalla activa.";
    } finally {
      pendingLock = false;
    }
  }

  for (const item of [side, sensitivity, invert, assist, vibration])
    item.addEventListener("change", save);
  if (typeof navigator.vibrate !== "function") {
    vibration.disabled = true;
    vibration.parentElement?.append(" · no disponible");
  }
  save();
  activate.onclick = () => {
    clearTouch();
    void tilt.enable();
  };
  field("touch-only").onclick = () => {
    clearTouch();
    tilt.stop();
    center.hidden = true;
    activate.hidden = false;
    tiltStatus.textContent = "Modo táctil.";
  };
  center.onclick = () => {
    clearTouch();
    tilt.center();
  };
  awake.onchange = () => {
    void wake();
  };
  document.addEventListener("visibilitychange", () => {
    tilt.center();
    void wake();
  });
  window.addEventListener("pagehide", () => {
    void lock?.release().catch(() => {});
  });
  field("drive-diagnostic").onclick = () => {
    const estimate = channel.sync.estimate(performance.now());
    const data = {
      experiment: "F07",
      transport: transportDiagnostic(),
      connected: linked,
      secureContext: isSecureContext,
      rttMs: estimate?.rtt ?? null,
      uncertaintyMs: estimate?.uncertainty ?? null,
      snapshotsSent: packets,
      feedbackReceived: feedbackCount,
      sensors: { active: tilt.active, samples: tilt.samples, rotations: tilt.rotations },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "qracer-mando.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return {
    configure(available: boolean) {
      linked = available;
      feedback.reset();
      tilt.center();
      flash.hidden = true;
      if (!linked) {
        tilt.stop();
        center.hidden = true;
        activate.hidden = false;
      }
      void wake();
    },
    steer(now: number) {
      return tilt.value(now);
    },
    scale(value: number) {
      return Math.max(
        -1,
        Math.min(1, value * sensitivity.valueAsNumber * (invert.checked ? -1 : 1)),
      );
    },
    assist: () => assist.checked,
    sent() {
      packets++;
    },
    receive(frame: Extract<DriveFrame, { type: "FEEDBACK" }>, now: number) {
      const captured = channel.sync.receiveTime(frame.captured, now, 300);
      if (document.hidden || !feedback.accept(frame.id, captured, now)) return;
      feedbackCount++;
      flash.textContent = feedbackLabels[frame.kind];
      flash.hidden = false;
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        flash.hidden = true;
      }, 650);
      if (vibration.checked && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(feedbackPulse[frame.kind]);
        } catch {
          /* Visual feedback remains available. */
        }
      }
    },
  };
}
