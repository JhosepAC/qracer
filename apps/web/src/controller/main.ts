import { controlsMarkup, mountDrive } from "./drive.ts";
import { PROTOCOL_VERSION } from "@qracer/protocol/version";
import { ROOM_ID, TOKEN } from "@qracer/session-core/wire";
import { parseInvitation, type RoomToken, SessionLink, sessionError } from "../session/link.ts";
import { featureFlags } from "../features.ts";
import "../styles.css";
import "../session/pair.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
root.dataset.protocolVersion = String(PROTOCOL_VERSION);
root.dataset.pairingEnabled = String(featureFlags.pairing.enabled);
root.innerHTML = `
  <header class="topbar"><a class="brand" href="/play/">Q<span>Racer</span></a><span class="tag">Tu mando</span></header>
  <main class="controller-shell">
    <section class="panel" aria-labelledby="controller-title">
      <h1 id="controller-title">El control<br>está en tus manos.</h1>
      <p class="status" id="pair-status" role="status">Escanea el QR de la PC o pega su enlace para conectar el mando.</p>
      <output id="pair-code" class="pair-code" aria-label="Código de comprobación" hidden></output>
      <form id="join-form" class="pair-form">
        <label for="join-link">Enlace de invitación</label>
        <input id="join-link" type="url" maxlength="512" autocomplete="off" spellcheck="false" required>
        <button class="button primary" type="submit">Solicitar acceso</button>
      </form>
      ${controlsMarkup}
      <button type="button" class="button" id="leave" hidden>Cerrar conexión</button>
      <a class="text-link" href="/play/">Volver a QRacer</a>
    </section>
  </main>`;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const drive = mountDrive(root);
const status = element("pair-status");
const form = element<HTMLFormElement>("join-form");
const input = element<HTMLInputElement>("join-link");
const leave = element<HTMLButtonElement>("leave");
const code = element<HTMLOutputElement>("pair-code");
const storageKey = "qracer.resume.v1";
let link: SessionLink | undefined;
let retained: RoomToken | undefined;

function remember(key?: RoomToken) {
  retained = key;
  try {
    if (key) sessionStorage.setItem(storageKey, JSON.stringify(key));
    else sessionStorage.removeItem(storageKey);
  } catch {
    /* The live tab can still reconnect in memory. */
  }
}

function readStored(): RoomToken | undefined {
  if (retained) return retained;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      typeof saved?.room === "string" &&
      typeof saved?.token === "string" &&
      ROOM_ID.test(saved.room) &&
      TOKEN.test(saved.token)
    )
      return saved;
  } catch {
    /* Storage is optional. */
  }
}

function connect(key: RoomToken, resume = false) {
  link?.dispose();
  drive.configure();
  if (!resume) remember();
  form.hidden = true;
  leave.hidden = false;
  code.hidden = true;
  status.textContent = resume ? "Reconectando…" : "Solicitando acceso…";
  link = new SessionLink(key, resume ? "resume" : "invite", {
    frame(frame) {
      if (frame.type === "RESUME") remember({ room: key.room, token: frame.token });
      if (frame.type === "ERROR") status.textContent = sessionError(frame.code);
      if (frame.type !== "STATE") {
        if ("epoch" in frame) drive.receive(frame);
        return;
      }
      if (frame.phase === "connected")
        drive.configure(frame.epoch, (packet) => link?.send(packet) ?? false);
      else drive.configure();
      if (root) root.dataset.epoch = String(frame.epoch);
      code.hidden = frame.phase !== "pending";
      code.value = frame.code ?? "";
      if (frame.phase === "pending")
        status.textContent = "Esperando aprobación. Comprueba el código con la PC.";
      else if (frame.phase === "connected")
        status.textContent = "Mando vinculado. Elige «Jugar con móvil» en la PC.";
      else status.textContent = "Esperando que la PC vuelva a conectarse…";
    },
    reconnecting() {
      drive.configure();
      code.hidden = true;
      status.textContent = "Reconectando con la sala…";
    },
    ended(message) {
      drive.configure();
      remember();
      form.hidden = false;
      leave.hidden = true;
      code.hidden = true;
      status.textContent = message;
    },
  });
  link.open();
}

form.onsubmit = (event) => {
  event.preventDefault();
  const key = parseInvitation(input.value.trim());
  input.value = "";
  if (key) connect(key);
  else status.textContent = "Pega una invitación válida del mismo QRacer.";
};

leave.onclick = () => {
  link?.dispose();
  drive.configure();
  remember();
  form.hidden = false;
  leave.hidden = code.hidden = true;
  status.textContent = "Conexión cerrada en este móvil. Pega una nueva invitación para volver.";
};

function acceptLocation() {
  const invitation = parseInvitation(location.href);
  if (location.hash || location.search) history.replaceState(null, "", location.pathname);
  if (!invitation) return false;
  connect(invitation);
  return true;
}
if (!acceptLocation()) {
  const saved = readStored();
  if (saved) connect(saved, true);
}
window.addEventListener("hashchange", acceptLocation);
window.addEventListener("pagehide", () => link?.dispose());
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  const saved = readStored();
  if (saved) connect(saved, true);
  else {
    form.hidden = false;
    leave.hidden = code.hidden = true;
    status.textContent = "Pega una invitación nueva desde la PC.";
  }
});
