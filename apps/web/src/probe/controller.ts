import { element, neutral, ProbeLink, relayUrl } from "./link.ts";
import "./probe.css";

const fragment = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", location.pathname);
element("app").innerHTML =
  `<header><span class="brand">Q<span>RACER</span></span><span class="eyebrow">MANDO / LAB 02</span></header>
  <section class="controller"><span class="eyebrow">TU SIGUIENTE GIRO</span><h1>Toma el control.</h1>
  <p id="status" role="status">Conectando con la PC…</p><p id="error" role="alert"></p>
  <div class="controls"><button id="left" aria-label="Girar a la izquierda">←</button><button id="right" aria-label="Girar a la derecha">→</button>
  <button id="brake" class="secondary">FRENO</button><button id="throttle">ACELERAR</button></div>
  <p>Suelta para neutralizar. Al bloquear el teléfono, la PC pausa la prueba.</p><small>Sesión experimental. Si se cierra, pide un nuevo QR en la PC.</small></section>`;
let link: ProbeLink | undefined;
let seq = 0;
const input = neutral();
const pointers = new Map<number, string>();
function release() {
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
  input.steer = Number(held.has("right")) - Number(held.has("left"));
  input.brake = Number(held.has("brake"));
  input.throttle = held.has("throttle") && !input.brake ? 1 : 0;
}
function send(force = false) {
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
  button.onpointercancel = up;
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
    if (frame.type === "ECHO" && frame.reply === false) link?.send({ ...frame, reply: true });
    if (frame.type === "READY" || frame.type === "PEER") {
      element("status").textContent = link?.connected ? "Conectado · WSS" : "Esperando a la PC";
      for (const button of document.querySelectorAll<HTMLButtonElement>(".controls button"))
        button.disabled = !link?.connected;
      if (!link?.connected) release();
    }
  };
  link.onclose = () => {
    release();
    for (const button of document.querySelectorAll<HTMLButtonElement>(".controls button"))
      button.disabled = true;
    element("status").textContent = "Sesión cerrada. Escanea un nuevo QR.";
  };
} catch {
  element("error").textContent = "El enlace no es válido. Escanea un QR nuevo en la PC.";
}
const timer = setInterval(send, 1000 / 30);
window.addEventListener("blur", release);
document.addEventListener("visibilitychange", release);
window.addEventListener("pagehide", () => {
  release();
  clearInterval(timer);
  link?.close();
});
