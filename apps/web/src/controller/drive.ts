import { transportLabel } from "../session/diagnostic.ts";
import { type DriveFrame, type DriveMode, INPUT_HZ } from "@qracer/session-core/wire";
import { DriveChannel } from "../session/drive-channel.ts";
import { mountOptions, optionsMarkup, steeringMarkup } from "./options.ts";
import { type Control, TouchInput } from "./touch.ts";
import "./drive.css";

export const controlsMarkup = `
<section class="handset" id="drive-shell" aria-label="Mando de carrera" hidden>
  <div class="handset-bar"><p id="drive-state">En espera</p>
    <button class="handset-pause" type="button" id="mobile-pause" disabled>Pausa</button></div>
  <div class="handset-telemetry"><span><strong id="mobile-speed">0</strong> km/h</span>
    <span id="mobile-integrity">Integridad · —</span><span>Nitro <meter id="mobile-nitro" max="1" value="0"></meter></span></div>
  ${steeringMarkup}
  <div class="handset-input">
    <div class="handset-steering">
      <button type="button" data-drive="wheel" class="virtual-wheel" aria-label="Volante táctil" disabled><span>VOLANTE</span></button>
      <div class="handset-arrows">
        <button type="button" data-drive="left" aria-label="Girar a la izquierda" disabled>←</button>
        <button type="button" data-drive="right" aria-label="Girar a la derecha" disabled>→</button>
      </div>
    </div>
    <div class="handset-actions">
      <button type="button" data-drive="brake" disabled>Freno</button>
      <button type="button" data-drive="throttle" disabled>Acelerar</button>
      <button type="button" data-drive="boost" disabled>Nitro</button>
    </div>
  </div>
  <details class="handset-help"><summary>Cómo conducir</summary>
    <p>Activa la inclinación con el móvil centrado. Inclínalo para girar y mantén el pedal para acelerar.
    También puedes usar el volante o las flechas. Elige «Jugar con móvil» en la PC y suelta los controles antes de continuar una carrera en pausa.</p>
  </details>
  ${optionsMarkup}
</section>`;

const modeText: Record<DriveMode, string> = {
  ready: "Listo · inicia en la PC",
  countdown: "Cuenta atrás",
  racing: "En carrera",
  paused: "Pausa · continúa en la PC",
  results: "Carrera terminada",
  keyboard: "La PC está usando el teclado",
};

export function mountDrive(root: HTMLElement) {
  const element = <T extends HTMLElement>(id: string) => {
    const node = root.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing #${id}`);
    return node;
  };
  const shell = element("drive-shell");
  const label = element("drive-state");
  const speed = element("mobile-speed");
  const integrity = element("mobile-integrity");
  const nitro = element<HTMLMeterElement>("mobile-nitro");
  const pause = element<HTMLButtonElement>("mobile-pause");
  const controls = shell.querySelectorAll<HTMLButtonElement>("[data-drive]");
  const wheel = shell.querySelector<HTMLButtonElement>("[data-drive=wheel]");
  const channel = new DriveChannel();
  const touch = new TouchInput();
  let send: ((frame: DriveFrame) => boolean) | undefined;
  let seq = 0;
  let timer = 0;
  let mode: DriveMode = "ready";
  let focused = true;

  const options = mountOptions(shell, channel, release, notifyPause);
  function snapshot(now: number) {
    const input = touch.snapshot(options.steer(now), options.assist());
    if (options.autoThrottle() && mode === "racing" && input.brake === 0)
      input.throttle = Math.max(input.throttle, 0.35);
    if (!touch.held("left") && !touch.held("right")) input.steer = options.scale(input.steer);
    return input;
  }

  function paint() {
    const input = snapshot(performance.now());
    wheel?.style.setProperty("--wheel-turn", `${input.steer * 36}deg`);
    for (const button of controls)
      button.toggleAttribute("data-held", touch.held(button.dataset.drive as Control));
  }

  function release() {
    touch.clear();
    paint();
  }

  function notifyPause() {
    release();
    if (channel.epoch !== undefined)
      send?.({ type: "DRIVE_PAUSE", epoch: channel.epoch, seq: ++seq });
  }

  function packetLoop() {
    window.clearTimeout(timer);
    if (channel.epoch === undefined || document.hidden || !focused) return;
    const now = performance.now();
    channel.tick(now);
    if (
      channel.sample(now) &&
      send?.({
        type: "INPUT",
        epoch: channel.epoch,
        seq: ++seq,
        captured: now,
        input: snapshot(now),
      })
    )
      options.sent();
    timer = window.setTimeout(packetLoop, Math.ceil(1000 / INPUT_HZ));
  }

  function render() {
    const now = performance.now();
    const estimate = channel.sync.estimate(now);
    label.textContent = estimate
      ? `${modeText[mode]} · ${transportLabel()} · RTT ${Math.round(estimate.rtt)} ms`
      : modeText[mode];
  }

  for (const button of controls) {
    const control = button.dataset.drive as Control;
    function position(event: PointerEvent) {
      const box = button.getBoundingClientRect();
      return Math.max(
        -1,
        Math.min(1, (event.clientX - box.left - box.width / 2) / (box.width / 2)),
      );
    }
    button.addEventListener("pointerdown", (event) => {
      if (
        button.disabled ||
        event.button !== 0 ||
        !touch.down(event.pointerId, control, position(event))
      )
        return;
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* A synthetic or cancelled pointer has no capture. */
      }
      paint();
    });
    button.addEventListener("pointermove", (event) => {
      if (control === "wheel") {
        touch.turn(event.pointerId, position(event));
        paint();
      }
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const)
      button.addEventListener(type, (event) => {
        touch.up(event.pointerId);
        paint();
      });
  }
  pause.onclick = notifyPause;

  function suspend() {
    if (!focused) return;
    focused = false;
    notifyPause();
    window.clearTimeout(timer);
  }

  function foreground() {
    if (document.hidden || focused) return;
    focused = true;
    release();
    packetLoop();
  }

  window.addEventListener("blur", suspend);
  window.addEventListener("focus", foreground);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
    else foreground();
  });
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", foreground);
  screen.orientation?.addEventListener("change", release);

  return {
    configure(epoch?: number, transport?: (frame: DriveFrame) => boolean) {
      const changed = channel.epoch !== epoch;
      channel.configure(epoch, transport);
      send = transport;
      shell.hidden = pause.disabled = epoch === undefined;
      for (const button of controls) button.disabled = epoch === undefined;
      if (changed) {
        options.configure(epoch !== undefined);
        release();
        seq = 0;
        mode = "ready";
        packetLoop();
      }
      render();
    },
    receive(frame: DriveFrame) {
      const now = performance.now();
      if (!channel.receive(frame, now)) return;
      if (frame.type === "FEEDBACK") options.receive(frame, now);
      if (frame.type === "DRIVE_STATE") {
        if (frame.mode === "paused" && mode !== "paused") release();
        mode = frame.mode;
        speed.textContent = String(Math.round(frame.speed));
        integrity.textContent = `Integridad · ${frame.integrity}`;
        nitro.value = frame.nitro;
        render();
      }
    },
  };
}
