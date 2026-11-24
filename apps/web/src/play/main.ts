import { RaceAudio } from "./audio.ts";
import { mountPresentation } from "./presentation.ts";
import { runReport } from "./run-report.ts";
import { mountRunMenu, modeNames } from "./run-menu.ts";
import { biomeAt, biomeNames } from "./biomes.ts";
import { transportLabel } from "../session/diagnostic.ts";
import { createRace, FixedClock, neutralInput, stepRace, TICK_HZ } from "@qracer/game-core";
import type { DriveFrame, DriveMode } from "@qracer/session-core/wire";
import { DriveChannel, RemoteInput } from "../session/drive-channel.ts";
import { PROTOCOL_VERSION } from "@qracer/protocol/version";
import { featureFlags } from "../features.ts";
import "../styles.css";
import "../session/pair.css";
import "./race.css";
import type { createRaceView } from "./race-view.ts";
import { isQuality, loadQuality, saveQuality } from "./quality.ts";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
root.dataset.protocolVersion = String(PROTOCOL_VERSION);
root.dataset.pairingEnabled = String(featureFlags.pairing.enabled);
root.dataset.mode = "menu";
root.innerHTML = `
  <div id="preview" aria-hidden="true"></div>
  <header class="race-bar"><a class="brand" href="/play/">Q<span>Racer</span></a>
    <button type="button" id="pause" hidden>Pausa <kbd>Esc</kbd></button></header>
  <main class="race-menu" id="menu">
    <section aria-labelledby="headline">
      <h1 id="headline">Circuito<br><span class="race-title-accent">costero</span></h1>
    </section>
    <section class="race-controls" aria-labelledby="connect-title">
      <h2 id="connect-title">Jugar</h2>
      <button class="button primary" type="button" id="start-mobile" hidden disabled>Jugar con móvil</button>
      <button type="button" id="host-pair" class="button pair-trigger" hidden>Conectar móvil</button>
      <p id="drive-link" class="fine-print" hidden></p>
      <button class="button primary" type="button" id="start" disabled>Salir a pista</button>
      <p id="graphics-status" role="status">Cargando circuito…</p>
      <progress id="graphics-progress" max="6" value="0" aria-label="Carga del circuito"></progress>
      <label class="race-quality" for="graphics-quality">Gráficos
        <select id="graphics-quality">
          <option value="low">Bajo</option>
          <option value="balanced">Equilibrado</option>
          <option value="high">Alto</option>
        </select>
      </label>
      <details class="race-keyboard"><summary>Controles de teclado</summary>
        <dl><div><dt>Dirección</dt><dd><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></dd></div>
        <div><dt>Acelera / frena</dt><dd><kbd>W</kbd> <kbd>S</kbd> / <kbd>↑</kbd> <kbd>↓</kbd></dd></div>
        <div><dt>Nitro</dt><dd><kbd>Shift</kbd></dd></div></dl>
      </details>
      <a href="/controller/">Conocer el mando</a>
    </section>
  </main>
  <section class="race-hud" id="hud" aria-label="Estado de carrera" hidden>
    <div class="race-score"><span>Puntos</span><strong id="score">0</strong><small id="distance">0 m</small></div>
    <label class="race-nitro">Nitro <meter id="nitro" min="0" max="1" value="1"></meter></label>
    <div class="race-dials"><span id="integrity">Integridad 3/3</span>
      <div class="race-speed"><strong id="speed">80</strong> <small>km/h</small></div></div>
    <small id="race-link" class="race-message race-link" hidden></small>
    <p class="race-message" id="message"></p>
    <output id="run-hud"></output>
    <button type="button" id="finish-practice" hidden>Terminar práctica</button>
  </section>
  <section class="race-overlay race-controls" id="overlay" aria-labelledby="overlay-title" hidden>
    <h2 id="overlay-title"></h2><p id="summary"></p>
    <dl class="race-results" id="race-results" hidden>
      <div><dt>Distancia</dt><dd id="result-distance"></dd></div>
      <div><dt>Velocidad máxima</dt><dd id="result-speed"></dd></div>
      <div><dt>Adelantamientos</dt><dd id="result-overtakes"></dd></div>
      <div><dt>Casi accidentes</dt><dd id="result-near"></dd></div>
    </dl>
    <button class="button primary" type="button" id="resume">Continuar</button>
    <button class="button" type="button" id="restart">Reiniciar</button>
    <button class="button" type="button" id="keyboard-fallback" hidden>Usar teclado</button>
    <button class="button" type="button" id="return-menu">Elegir otro recorrido</button>
    <p id="run-result" class="fine-print" hidden></p>
    <button type="button" class="button" id="download-run" hidden>Guardar resumen de carrera</button>
  </section>`;

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}`);
  return result as T;
}

const pair = element<HTMLButtonElement>("host-pair");
pair.hidden = !featureFlags.pairing.enabled;
pair.onclick = async () => {
  try {
    pair.disabled = true;
    const { mountPairing } = await import("../session/host.ts");
    mountPairing(pair, { connection: mobileConnection, message: mobileFrame });
    pair.disabled = false;
    pair.click();
  } catch {
    pair.disabled = false;
    element("graphics-status").textContent = "No se pudo abrir el panel de vinculación.";
  }
};

const sound = new RaceAudio();
mountPresentation(sound, () => {
  if (!clock.paused || resumeUntil) stop();
});
const runMenu = mountRunMenu(root, () => {
  clock.reset(runMenu.create());
  void mount();
});
const preview = element("preview");
const start = element<HTMLButtonElement>("start");
const pause = element<HTMLButtonElement>("pause");
const resume = element<HTMLButtonElement>("resume");
const restart = element<HTMLButtonElement>("restart");
const hud = element("hud");
const message = element("message");
const status = element("graphics-status");
const progress = element<HTMLProgressElement>("graphics-progress");
const quality = element<HTMLSelectElement>("graphics-quality");
quality.value = loadQuality();
const score = element("score");
const distance = element("distance");
const speed = element("speed");
const integrity = element("integrity");
const nitro = element<HTMLMeterElement>("nitro");
const keys = new Set<string>();
const remote = new RemoteInput();
const channel = new DriveChannel();
let sendDrive: ((frame: DriveFrame) => boolean) | undefined;
let source: "keyboard" | "mobile" = "keyboard";
let resumeUntil = 0;
let assisted = false;
let lastState = -Infinity;
let eventId = 0;
const startMobile = element<HTMLButtonElement>("start-mobile");
const driveLink = element("drive-link");
const raceLink = element("race-link");
const fallback = element<HTMLButtonElement>("keyboard-fallback");
const controls = /^(Key[ADWS]|Arrow(Left|Right|Up|Down)|Shift(Left|Right))$/;
let feedback = "";
let feedbackUntil = 0;
const pressed = (...codes: string[]) => Number(codes.some((code) => keys.has(code)));
const clock = new FixedClock(createRace(), (state) => {
  const input =
    source === "mobile"
      ? remote.get(performance.now())
      : keys.size
        ? {
            steer: pressed("KeyD", "ArrowRight") - pressed("KeyA", "ArrowLeft"),
            throttle: pressed("KeyW", "ArrowUp"),
            brake: pressed("KeyS", "ArrowDown"),
            boost: Boolean(pressed("ShiftLeft", "ShiftRight")),
          }
        : neutralInput;
  if ("assist" in input && input.assist) assisted = true;
  const next = stepRace(state, input);
  sound.update(next, input);
  const event = next.events.find(({ type }) => type === "impact") ?? next.events.at(-1);
  if (source === "mobile" && channel.epoch !== undefined && !resumeUntil) {
    const kind =
      event?.type === "impact"
        ? "impact"
        : event?.type === "near"
          ? "near"
          : next.driver.boosting && !state.driver.boosting
            ? "boost"
            : undefined;
    if (kind)
      sendDrive?.({
        type: "FEEDBACK",
        epoch: channel.epoch,
        id: ++eventId,
        kind,
        captured: performance.now(),
      });
  }
  if (event) {
    feedback = { impact: "Impacto", graze: "Roce", near: "¡Por poco!", overtake: "Adelantamiento" }[
      event.type
    ];
    feedbackUntil = next.tick + TICK_HZ;
  }
  return next;
});
clock.pause();

let view: Awaited<ReturnType<typeof createRaceView>> | undefined;
let loading: AbortController | undefined;
let contextLost = false;
let raf = 0;
let lastHud = -Infinity;

function updateHud() {
  const state = clock.current;
  const remaining = Math.max(0, Math.ceil((state.run.limit - state.tick) / TICK_HZ));
  element("run-hud").textContent =
    `${modeNames[state.run.mode]} · ${biomeNames[biomeAt(state.driver.s, runMenu.biome())]}${Number.isFinite(remaining) ? ` · ${remaining} s` : ""} · Combo ×${state.combo}`;
  element("finish-practice").hidden = state.run.mode !== "practice";
  if (view && !contextLost) preview.dataset.renderStats = JSON.stringify(view.stats());
  speed.textContent = String(Math.round(state.driver.speed * 3.6));
  distance.textContent = `${Math.floor(state.driver.s)} m`;
  score.textContent = String(state.score);
  integrity.textContent = `Integridad ${state.driver.integrity}/${state.config.integrity}`;
  nitro.value = state.config.nitroSeconds > 0 ? state.driver.nitro / state.config.nitroSeconds : 0;
  message.textContent = resumeUntil
    ? String(Math.max(1, Math.ceil((resumeUntil - performance.now()) / 1000)))
    : state.phase === "countdown"
      ? String(Math.ceil(state.countdown / TICK_HZ))
      : state.tick < feedbackUntil
        ? feedback
        : "";
}

function stop(finished = false, reason = "") {
  sound.setActive(false);
  resumeUntil = 0;
  clock.pause();
  keys.clear();
  cancelAnimationFrame(raf);
  if (!contextLost && !document.hidden) view?.draw(clock.current, clock.current, 0);
  updateHud();
  root?.setAttribute("data-mode", finished ? "results" : "paused");
  element("overlay").hidden = false;
  pause.hidden = true;
  hud.hidden = true;
  element("overlay-title").textContent = finished ? "Fin de carrera" : "Carrera en pausa";
  element("race-results").hidden = !finished;
  const result = clock.current;
  element("summary").textContent = finished
    ? `${result.score} puntos${assisted ? " · asistida" : ""}`
    : reason || "Pulsa Continuar para volver a la pista.";
  element("run-result").hidden = !finished;
  element("download-run").hidden = !finished;
  if (finished) {
    element("run-result").textContent = runMenu.finish(result, assisted);
    element("result-distance").textContent = `${Math.floor(result.driver.s)} m`;
    element("result-speed").textContent = `${Math.round(result.topSpeed * 3.6)} km/h`;
    element("result-overtakes").textContent = String(result.overtakes);
    element("result-near").textContent = String(result.nearMisses);
  }
  resume.hidden = finished;
  resume.disabled = contextLost;
  restart.disabled = contextLost;
  fallback.hidden = source !== "mobile";
  if (!document.hidden) (finished ? restart : resume).focus();
}

function frame(now: number) {
  if (!view) return;
  if (source === "mobile" && remote.timedOut(performance.now()))
    return stop(false, "Se perdió la entrada del mando. Suelta los controles para continuar.");
  if (resumeUntil) {
    if (performance.now() < resumeUntil) {
      updateHud();
      raf = requestAnimationFrame(frame);
      return;
    }
    resumeUntil = 0;
    clock.resume();
  }
  const alpha = clock.frame(now);
  if (clock.current.phase === "finished") return stop(true);
  if (clock.paused) return stop();
  view.draw(clock.previous, clock.current, alpha);
  if (now - lastHud >= 100) {
    lastHud = now;
    updateHud();
  }
  raf = requestAnimationFrame(frame);
}

function run(reset: boolean) {
  if (
    !view ||
    contextLost ||
    environmentWaiting ||
    document.hidden ||
    (source === "mobile" && !remote.ready(performance.now()))
  )
    return;
  if (reset) {
    clock.reset(runMenu.create());
    if (root) {
      root.dataset.runCategory = clock.current.run.category;
      root.dataset.seed = String(clock.current.seed);
    }
    feedbackUntil = 0;
    assisted = false;
  } else if (source === "mobile" && clock.current.phase === "countdown") {
    clock.reset({ ...clock.current, countdown: 3 * TICK_HZ });
  }
  sound.setActive(true);
  keys.clear();
  resumeUntil =
    source === "mobile" && !reset && clock.current.phase === "racing"
      ? performance.now() + 3000
      : 0;
  if (resumeUntil) clock.pause();
  else clock.resume();
  if (root) root.dataset.control = source;
  raceLink.hidden = source !== "mobile";
  lastHud = -Infinity;
  root?.setAttribute("data-mode", "playing");
  element("menu").hidden = true;
  element("overlay").hidden = true;
  hud.hidden = false;
  pause.hidden = false;
  pause.focus();
  updateHud();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function mobileConnection(epoch?: number, send?: (frame: DriveFrame) => boolean) {
  const changed = channel.epoch !== epoch;
  channel.configure(epoch, send);
  remote.configure(epoch);
  sendDrive = send;
  if (changed && source === "mobile" && (!clock.paused || resumeUntil))
    stop(false, "Se perdió la conexión con el mando. Espera a que vuelva o usa el teclado.");
  refreshMobile(performance.now());
}

function mobileFrame(packet: DriveFrame) {
  const now = performance.now();
  if (!channel.receive(packet, now)) return;
  if (packet.type === "INPUT")
    remote.accept(packet, channel.sync.receiveTime(packet.captured, now), now);
  else if (packet.type === "DRIVE_PAUSE" && packet.seq > remote.seq) {
    remote.seq = packet.seq;
    remote.clear();
    if (source === "mobile" && (!clock.paused || resumeUntil))
      stop(false, "El móvil solicitó una pausa. Suelta los controles para continuar.");
  }
}

function refreshMobile(now: number) {
  channel.tick(now);
  const linked = channel.epoch !== undefined;
  const ready = linked && remote.ready(now);
  startMobile.hidden = driveLink.hidden = !linked;
  startMobile.disabled = !view || contextLost || !ready;
  const estimate = channel.sync.estimate(now);
  const latency = estimate
    ? `${transportLabel()} · RTT ${Math.round(estimate.rtt)} ms`
    : `${transportLabel()} · Sincronizando`;
  const summary = ready ? `Mando listo · ${latency}` : `Suelta los controles · ${latency}`;
  if (driveLink.textContent !== summary) driveLink.textContent = summary;
  if (raceLink.textContent !== latency) raceLink.textContent = latency;
  if (source === "mobile") {
    resume.disabled = contextLost || environmentWaiting || !ready;
    restart.disabled = contextLost || !ready;
    if ((!clock.paused || resumeUntil) && remote.timedOut(now))
      stop(false, "Se perdió la entrada del mando. Suelta los controles para continuar.");
  }
  if (!linked || now - lastState < 200 || channel.epoch === undefined) return;
  lastState = now;
  const state = clock.current;
  const mode: DriveMode =
    state.phase === "finished"
      ? "results"
      : source === "keyboard"
        ? root?.dataset.mode === "menu"
          ? "ready"
          : "keyboard"
        : resumeUntil
          ? "countdown"
          : clock.paused
            ? "paused"
            : state.phase;
  sendDrive?.({
    type: "DRIVE_STATE",
    epoch: channel.epoch,
    mode,
    speed: state.driver.speed * 3.6,
    integrity: state.driver.integrity,
    nitro: state.config.nitroSeconds > 0 ? state.driver.nitro / state.config.nitroSeconds : 0,
  });
}
window.setInterval(() => {
  if (channel.epoch !== undefined || source === "mobile") refreshMobile(performance.now());
}, 25);

async function mount() {
  environmentWaiting = false;
  loading?.abort();
  const attempt = new AbortController();
  loading = attempt;
  const previous = view;
  view = undefined;
  previous?.dispose();
  start.disabled = startMobile.disabled = resume.disabled = restart.disabled = true;
  preview.dataset.graphics = "loading";
  progress.hidden = false;
  progress.value = 0;
  status.textContent = "Cargando circuito…";
  const selected = isQuality(quality.value) ? quality.value : "balanced";
  let timedOut = false;
  const deadline = window.setTimeout(() => {
    timedOut = true;
    attempt.abort();
  }, 15000);
  try {
    const { createRaceView } = await import("./race-view.ts");
    attempt.signal.throwIfAborted();
    progress.value = 1;
    status.textContent = "Descargando modelos";
    const scene = await createRaceView(preview, attempt.signal, {
      quality: selected,
      environment: runMenu.biome(),
      paint: runMenu.paint,
      progress(completed, label) {
        if (loading !== attempt) return;
        progress.value = completed;
        status.textContent = label;
      },
    });
    if (attempt.signal.aborted) {
      scene.dispose();
      attempt.signal.throwIfAborted();
    }
    view = scene;
    contextLost = false;
    scene.canvas.addEventListener("webglcontextlost", (event) => {
      if (view !== scene) return;
      event.preventDefault();
      contextLost = true;
      start.disabled = true;
      if (!clock.paused || resumeUntil) stop();
      resume.disabled = restart.disabled = true;
      status.textContent = "Se perdió el contexto gráfico.";
    });
    scene.canvas.addEventListener("webglcontextrestored", () => {
      if (view !== scene) return;
      void mount();
    });
    scene.draw(clock.current, clock.current, 0);
    preview.dataset.graphics = "ready";
    preview.dataset.quality = selected;
    preview.dataset.renderStats = JSON.stringify(scene.stats());
    progress.hidden = true;
    start.disabled = resume.disabled = restart.disabled = false;
    status.textContent = "";
  } catch (error) {
    if (loading !== attempt || (attempt.signal.aborted && !timedOut)) return;
    view?.dispose();
    view = undefined;
    preview.dataset.graphics = "failed";
    progress.hidden = true;
    status.textContent = timedOut
      ? "El circuito tardó demasiado en cargar. Recarga para reintentar."
      : error instanceof Error && error.message.startsWith("Activa WebGL 2")
        ? error.message
        : "No se pudo cargar el circuito. Recarga para reintentar.";
  } finally {
    window.clearTimeout(deadline);
    if (loading === attempt) loading = undefined;
  }
}

let environmentWaiting = false;
preview.addEventListener("environment-wait", () => {
  environmentWaiting = true;
  if (!clock.paused || resumeUntil)
    stop(false, "Preparando el siguiente entorno. Espera para continuar.");
  resume.disabled = true;
});
preview.addEventListener("environment-ready", () => {
  environmentWaiting = false;
  resume.disabled = contextLost;
});
preview.addEventListener("environment-error", () => {
  environmentWaiting = true;
  element("summary").textContent =
    "No se pudo descargar el entorno. Vuelve al menú para reintentar.";
  resume.disabled = true;
});
element("download-run").onclick = () => {
  if (clock.current.phase !== "finished") return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(runReport(clock.current), null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "qracer-carrera.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
element("finish-practice").onclick = () => {
  if (clock.current.run.mode !== "practice") return;
  clock.reset({ ...clock.current, phase: "finished" });
  stop(true);
};
element("return-menu").onclick = () => {
  sound.setActive(false);
  clock.pause();
  keys.clear();
  resumeUntil = 0;
  cancelAnimationFrame(raf);
  clock.reset(runMenu.create());
  root?.setAttribute("data-mode", "menu");
  element("menu").hidden = false;
  element("overlay").hidden = true;
  hud.hidden = true;
  pause.hidden = true;
  void mount();
};

quality.onchange = () => {
  if (!isQuality(quality.value)) return;
  saveQuality(quality.value);
  void mount();
};
start.onclick = () => {
  source = "keyboard";
  run(true);
};
startMobile.onclick = () => {
  source = "mobile";
  run(true);
};
fallback.onclick = () => {
  source = "keyboard";
  run(clock.current.phase === "finished");
};
restart.onclick = () => run(true);
resume.onclick = () => run(false);
pause.onclick = () => stop();
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || (clock.paused && !resumeUntil)) return;
  if (event.code === "Escape") {
    event.preventDefault();
    if (!event.repeat) stop();
  } else if (source === "keyboard" && controls.test(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => {
  if (!clock.paused || resumeUntil) stop();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (!clock.paused || resumeUntil)) stop();
});
window.addEventListener("pagehide", () => {
  sound.setActive(false);
  if (!clock.paused || resumeUntil) stop();
  loading?.abort();
  loading = undefined;
  view?.dispose();
  view = undefined;
  delete preview.dataset.graphics;
  delete preview.dataset.renderStats;
  start.disabled = resume.disabled = restart.disabled = true;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void mount();
});
void mount();
