import { element, exportReport, neutral, ProbeLink, relayUrl } from "./link.ts";
import { TiltProbe } from "./tilt.ts";
import { RtcProbe } from "./rtc.ts";
import "./probe.css";

const fragment = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", location.pathname);
element("app").innerHTML =
  `<header><span class="brand">Q<span>RACER</span></span><span class="eyebrow">MANDO / LAB 02</span></header>
  <section class="controller"><span class="eyebrow">TU SIGUIENTE GIRO</span><h1>Toma el control.</h1>
  <p id="status" role="status">Conectando con la PC…</p><p id="error" role="alert"></p>
  <div class="controls"><button id="left" aria-label="Girar a la izquierda">←</button><button id="right" aria-label="Girar a la derecha">→</button>
  <button id="brake" class="secondary">FRENO</button><button id="throttle">ACELERAR</button></div>
  <p>Suelta para neutralizar. Al bloquear el teléfono, la PC pausa la prueba.</p>
  <details><summary>Pruebas opcionales</summary><p id="sensor-status" role="status">El táctil está listo. La inclinación es opcional.</p>
  <button id="tilt" class="secondary">Activar inclinación</button> <button id="calibrate" class="secondary">Centrar</button>
  <button id="vibrate" class="secondary">Probar vibración</button><p id="haptic-status"></p><p id="rtc-status">ICE sin probar</p>
  <button id="report" class="secondary">Exportar diagnóstico</button></details>
  <small>Sesión experimental. Si se cierra, pide un nuevo QR en la PC.</small></section>`;
let link: ProbeLink | undefined;
let rtc: RtcProbe | undefined;
const tilt = new TiltProbe((message) => {
  element("sensor-status").textContent = message;
});
const diagnostics = { pointerCancels: 0, haptics: "unrequested", secureContext: isSecureContext };
let seq = 0;
const input = neutral();
const pointers = new Map<number, string>();
function release() {
  tilt.stop();
  pointers.clear();
  input.steer = 0;
  input.throttle = 0;
  input.brake = 0;
  for (const button of document.querySelectorAll(".controls button"))
    button.removeAttribute("data-held");
  send(true);
}
function update() {
  const held = new Set(pointers.values());
  input.steer =
    held.has("right") || held.has("left")
      ? Number(held.has("right")) - Number(held.has("left"))
      : tilt.value;
  input.brake = Number(held.has("brake"));
  input.throttle = held.has("throttle") && !input.brake ? 1 : 0;
}
function send(force = false) {
  if (!link?.connected) return;
  update();
  if (force || !document.hidden) link?.send({ type: "INPUT", ...input, seq: ++seq });
}
for (const id of ["left", "right", "brake", "throttle"]) {
  const button = element<HTMLButtonElement>(id);
  button.disabled = true;
  button.onpointerdown = (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, id);
    button.dataset.held = "";
    update();
    send();
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    button.removeAttribute("data-held");
    update();
    send();
  };
  button.onpointerup = up;
  button.onpointercancel = (event) => {
    diagnostics.pointerCancels++;
    up(event);
  };
  button.onlostpointercapture = up;
  button.oncontextmenu = (event) => event.preventDefault();
}
try {
  link = new ProbeLink(
    relayUrl(fragment.get("relay") ?? ""),
    fragment.get("id") ?? "",
    "controller",
    fragment.get("token") ?? "",
  );
  link.onframe = (frame) => {
    if (frame.type === "SIGNAL") rtc?.receive(frame);
    if (frame.type === "ECHO" && frame.reply === false) link?.send({ ...frame, reply: true });
    if (frame.type === "READY" || frame.type === "PEER") {
      if (link?.connected && !rtc) {
        rtc = new RtcProbe(link, false, (message) => {
          element("rtc-status").textContent = message;
        });
        void rtc.start().catch(() => rtc?.dispose());
      }
      element("status").textContent = link?.connected ? "Conectado · WSS" : "Esperando a la PC";
      for (const button of document.querySelectorAll<HTMLButtonElement>(".controls button"))
        button.disabled = !link?.connected;
      if (!link?.connected) {
        release();
        rtc?.dispose();
      }
    }
  };
  link.onclose = () => {
    rtc?.dispose();
    release();
    for (const button of document.querySelectorAll<HTMLButtonElement>(".controls button"))
      button.disabled = true;
    element("status").textContent = "Sesión cerrada. Escanea un nuevo QR.";
  };
} catch {
  element("error").textContent = "El enlace no es válido. Escanea un QR nuevo en la PC.";
}
element("tilt").onclick = () => {
  void tilt.enable();
};
element("calibrate").onclick = () => tilt.calibrate();
element("vibrate").onclick = () => {
  diagnostics.haptics =
    typeof navigator.vibrate === "function" && navigator.vibrate(40)
      ? "accepted-by-api"
      : "unsupported-or-denied";
  element("haptic-status").textContent =
    diagnostics.haptics === "accepted-by-api"
      ? "La API aceptó el pulso. Confirma si lo sentiste."
      : "Vibración no disponible. El táctil funciona igual.";
};
element("report").onclick = () =>
  exportReport({
    experiment: "F02-controller",
    ...diagnostics,
    orientation: tilt.report,
    rtc: rtc?.report ?? null,
  });
const timer = setInterval(send, 1000 / 30);
window.addEventListener("blur", release);
document.addEventListener("visibilitychange", release);
window.addEventListener("pagehide", () => {
  release();
  clearInterval(timer);
  tilt.dispose();
  rtc?.dispose();
  link?.close();
});
