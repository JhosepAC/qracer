import { createRace, FixedClock, neutralInput, stepRace, TICK_HZ } from "@qracer/game-core";
import { PROTOCOL_VERSION } from "@qracer/protocol/version";
import { featureFlags } from "../features.ts";
import "../styles.css";
import "../session/pair.css";
import "./race.css";
import type { createRaceView } from "./race-view.ts";

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
      <p class="race-location">Circuito costero</p>
      <h1 id="headline">Siente cada<br><em>kilómetro.</em></h1>
    </section>
    <section class="race-controls" aria-labelledby="connect-title">
      <h2 id="connect-title">Conduce con teclado</h2>
      <dl><div><dt>Dirección</dt><dd><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></dd></div>
      <div><dt>Acelera / frena</dt><dd><kbd>W</kbd> <kbd>S</kbd> / <kbd>↑</kbd> <kbd>↓</kbd></dd></div>
      <div><dt>Nitro</dt><dd><kbd>Shift</kbd></dd></div></dl>
      <button class="button primary" type="button" id="start" disabled>Salir a pista</button>
      <p id="graphics-status" role="status">Cargando circuito…</p>
      <button type="button" id="host-pair" class="button pair-trigger" hidden>Conectar móvil</button>
      <a href="/controller/">Conocer el mando</a>
    </section>
  </main>
  <section class="race-hud" id="hud" aria-label="Estado de carrera" hidden>
    <div class="race-score"><span>Puntos</span><strong id="score">0</strong><small id="distance">0 m</small></div>
    <div class="race-dials"><span id="integrity">Integridad 3/3</span><label>Nitro <meter id="nitro" min="0" max="1" value="1"></meter></label>
      <div class="race-speed"><strong id="speed">80</strong> km/h</div></div>
    <p class="race-message" id="message"></p>
  </section>
  <section class="race-overlay race-controls" id="overlay" aria-labelledby="overlay-title" hidden>
    <h2 id="overlay-title"></h2><p id="summary"></p>
    <button class="button primary" type="button" id="resume">Continuar</button>
    <button class="button" type="button" id="restart">Reiniciar</button>
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
    mountPairing(pair);
    pair.disabled = false;
    pair.click();
  } catch {
    pair.disabled = false;
    element("graphics-status").textContent = "No se pudo abrir el panel de vinculación.";
  }
};

const preview = element("preview");
const start = element<HTMLButtonElement>("start");
const pause = element<HTMLButtonElement>("pause");
const resume = element<HTMLButtonElement>("resume");
const restart = element<HTMLButtonElement>("restart");
const hud = element("hud");
const message = element("message");
const status = element("graphics-status");
const score = element("score");
const distance = element("distance");
const speed = element("speed");
const integrity = element("integrity");
const nitro = element<HTMLMeterElement>("nitro");
const keys = new Set<string>();
const controls = /^(Key[ADWS]|Arrow(Left|Right|Up|Down)|Shift(Left|Right))$/;
let feedback = "";
let feedbackUntil = 0;
const pressed = (...codes: string[]) => Number(codes.some((code) => keys.has(code)));
const clock = new FixedClock(createRace(), (state) => {
  const next = stepRace(
    state,
    keys.size
      ? {
          steer: pressed("KeyD", "ArrowRight") - pressed("KeyA", "ArrowLeft"),
          throttle: pressed("KeyW", "ArrowUp"),
          brake: pressed("KeyS", "ArrowDown"),
          boost: Boolean(pressed("ShiftLeft", "ShiftRight")),
        }
      : neutralInput,
  );
  const event = next.events.find(({ type }) => type === "impact") ?? next.events.at(-1);
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
  if (view && !contextLost) preview.dataset.renderStats = JSON.stringify(view.stats());
  speed.textContent = String(Math.round(state.driver.speed * 3.6));
  distance.textContent = `${Math.floor(state.driver.s)} m`;
  score.textContent = String(state.score);
  integrity.textContent = `Integridad ${state.driver.integrity}/${state.config.integrity}`;
  nitro.value = state.config.nitroSeconds > 0 ? state.driver.nitro / state.config.nitroSeconds : 0;
  message.textContent =
    state.phase === "countdown"
      ? String(Math.ceil(state.countdown / TICK_HZ))
      : state.tick < feedbackUntil
        ? feedback
        : "";
}

function stop(finished = false) {
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
  element("summary").textContent = finished
    ? `${clock.current.score} puntos · ${Math.floor(clock.current.driver.s)} m · Máxima ${Math.round(clock.current.topSpeed * 3.6)} km/h · ${clock.current.overtakes} adelantamientos · ${clock.current.nearMisses} casi accidentes`
    : "Pulsa Continuar para volver a la pista.";
  resume.hidden = finished;
  resume.disabled = contextLost;
  restart.disabled = contextLost;
  if (!document.hidden) (finished ? restart : resume).focus();
}

function frame(now: number) {
  if (!view) return;
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
  if (!view || contextLost || document.hidden) return;
  if (reset) {
    clock.reset(createRace());
    feedbackUntil = 0;
  }
  keys.clear();
  clock.resume();
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

async function mount() {
  const attempt = new AbortController();
  loading = attempt;
  let timedOut = false;
  const deadline = window.setTimeout(() => {
    timedOut = true;
    attempt.abort();
  }, 15000);
  try {
    const { createRaceView } = await import("./race-view.ts");
    attempt.signal.throwIfAborted();
    const scene = await createRaceView(preview, attempt.signal);
    if (attempt.signal.aborted) {
      scene.dispose();
      attempt.signal.throwIfAborted();
    }
    view = scene;
    contextLost = false;
    scene.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      start.disabled = true;
      if (!clock.paused) stop();
      resume.disabled = restart.disabled = true;
      status.textContent = "Se perdió el contexto gráfico.";
    });
    scene.canvas.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      start.disabled = resume.disabled = restart.disabled = false;
      status.textContent = "";
      scene.draw(clock.current, clock.current, 0);
    });
    scene.draw(clock.current, clock.current, 0);
    preview.dataset.graphics = "ready";
    start.disabled = resume.disabled = restart.disabled = false;
    status.textContent = "";
  } catch (error) {
    if (loading !== attempt || (attempt.signal.aborted && !timedOut)) return;
    view?.dispose();
    view = undefined;
    status.textContent = timedOut
      ? "El circuito tardó demasiado en cargar. Recarga para reintentar."
      : error instanceof Error && error.message.startsWith("Activa WebGL 2")
        ? error.message
        : "No se pudo cargar el circuito. Recarga para reintentar.";
  } finally {
    window.clearTimeout(deadline);
  }
}

start.onclick = () => run(true);
restart.onclick = () => run(true);
resume.onclick = () => run(false);
pause.onclick = () => stop();
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || clock.paused) return;
  if (event.code === "Escape") {
    event.preventDefault();
    if (!event.repeat) stop();
  } else if (controls.test(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => {
  if (!clock.paused) stop();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !clock.paused) stop();
});
window.addEventListener("pagehide", () => {
  if (!clock.paused) stop();
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
