import qrcode from "qrcode-generator";
import { element, exportReport, neutral, ProbeLink, relayUrl, validInput } from "./link.ts";
import "./probe.css";
import { RtcProbe } from "./rtc.ts";
import type { createStress, Profile } from "./scene.ts";
import { expiredInput } from "./freshness.ts";

element("app").innerHTML = `
  <header><a class="brand" href="/play/">Q<span>RACER</span></a><span class="eyebrow">LAB / 02</span></header>
  <section class="host-layout">
    <div class="stage"><div class="stage-title"><span class="eyebrow">PRUEBA DE CONEXIÓN</span><h1>Tu teléfono.<br>El siguiente giro.</h1></div>
      <div id="viewport" aria-label="Escena de prueba"><div class="input-meter" id="meter">EN ESPERA</div></div>
      <div class="telemetry"><strong id="status" role="status">Crea un enlace para comenzar</strong><span id="metrics">RTT — · Control —</span></div>
    </div>
    <aside><span class="eyebrow">01 / VINCULA TU MANDO</span><h2>Escanea y conecta</h2>
      <p>Abre la cámara de tu teléfono. Este laboratorio prueba el enlace antes del juego.</p>
      <form id="create"><label for="relay">Origen del relay</label><input id="relay" type="url" required />
      <label for="key">Clave de la prueba pública</label><input id="key" type="password" autocomplete="off" spellcheck="false" />
      <button id="new" type="submit">Crear enlace</button></form>
      <div id="qr" aria-label="Código QR de invitación"></div><p id="expiry"></p>
      <a id="invite" hidden rel="noreferrer" target="_blank">Abrir mando de prueba</a>
      <p id="error" role="alert"></p><p id="rtc-status">ICE sin probar</p><button id="export" class="secondary">Exportar mediciones</button>
      <p id="graphics-status" role="status">Preparando muestra 3D…</p>
      <label for="profile">Calidad de la prueba</label><select id="profile"><option value="low">Baja · 720p</option><option value="balanced" selected>Equilibrada</option><option value="high">Alta</option></select>
      <small>Invitación de un solo uso · 2 min para conectar · sesión de 20 min. Tras desconectar, crea otro enlace.</small>
    </aside>
  </section>`;
const relay = element<HTMLInputElement>("relay");
relay.value = location.hostname.endsWith("pages.dev")
  ? "https://qracer-f02-probe.jhosep-ac.workers.dev"
  : location.port === "5173"
    ? "http://127.0.0.1:3000"
    : location.origin;
let link: ProbeLink | undefined;
let rtc: RtcProbe | undefined;
let graphics: Awaited<ReturnType<typeof createStress>> | undefined;
let pageLeft = false;
const parameters = new URLSearchParams(location.search);
const profile: Profile =
  parameters.get("quality") === "low"
    ? "low"
    : parameters.get("quality") === "high"
      ? "high"
      : "balanced";
element<HTMLSelectElement>("profile").value = profile;
element<HTMLSelectElement>("profile").onchange = () => {
  const url = new URL(location.href);
  url.searchParams.set("quality", element<HTMLSelectElement>("profile").value);
  location.assign(url);
};
if (parameters.has("benchmark")) document.body.classList.add("benchmark");
void import("./scene.ts")
  .then(async ({ createStress }) => {
    graphics = await createStress(
      element("viewport"),
      profile,
      parameters.has("benchmark"),
      (message) => {
        element("graphics-status").textContent = message;
      },
    );
    if (pageLeft) graphics.dispose();
  })
  .catch((error: unknown) => {
    element("graphics-status").textContent =
      error instanceof Error
        ? `${error.message} El QR sigue disponible.`
        : "No se pudo cargar la escena. El QR sigue disponible.";
  });
element("viewport").addEventListener("probe-report", () => {
  element("viewport").dispatchEvent(
    new CustomEvent("probe-report-result", { detail: graphics?.report() ?? null }),
  );
});
let input = neutral();
let receivedAt = -Infinity;
let inviteUntil = 0;
let joined = false;
let startedAt = 0;
let lastSeq = -1;
let gaps = 0;
let frames = 0;
let stale = 0;
let wasStale = true;
let ping = 0;
const pending = new Map<number, number>();
const rtts: number[] = [];
element("create").onsubmit = async (event) => {
  event.preventDefault();
  element("error").textContent = "";
  element<HTMLButtonElement>("new").disabled = true;
  rtc?.dispose();
  rtc = undefined;
  if (link) {
    link.onclose = () => {};
    link.onframe = () => {};
    link.close();
  }
  link = undefined;
  element("qr").replaceChildren();
  element<HTMLAnchorElement>("invite").hidden = true;
  input = neutral();
  inviteUntil = 0;
  joined = false;
  receivedAt = -Infinity;
  try {
    const base = relayUrl(relay.value);
    const key = element<HTMLInputElement>("key").value;
    const response = await fetch(new URL("/probe/session", base), {
      method: "POST",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Se alcanzó el límite de pruebas. Usa el relay local o vuelve mañana."
          : `No se pudo crear la sesión (${response.status}). Revisa origen y clave.`,
      );
    const keys = await response.json();
    link = new ProbeLink(base, keys.id, "host", keys.hostToken);
    frames = 0;
    gaps = 0;
    stale = 0;
    lastSeq = -1;
    wasStale = true;
    rtts.length = 0;
    pending.clear();
    startedAt = performance.now();
    link.onframe = (frame) => {
      if (link?.connected && !joined) {
        joined = true;
        inviteUntil = 0;
        element("qr").replaceChildren();
        const invitation = element<HTMLAnchorElement>("invite");
        invitation.hidden = true;
        invitation.removeAttribute("href");
      }
      if (frame.type === "SIGNAL") rtc?.receive(frame);
      if ((frame.type === "PEER" || frame.type === "READY") && link?.connected && !rtc) {
        rtc = new RtcProbe(link, true, (message) => {
          element("rtc-status").textContent = message;
        });
        void rtc.start().catch(() => rtc?.dispose());
      }
      if (frame.type === "INPUT" && validInput(frame) && frame.seq > lastSeq) {
        if (lastSeq >= 0) gaps += frame.seq - lastSeq - 1;
        lastSeq = frame.seq;
        input = frame;
        receivedAt = performance.now();
        frames++;
      }
      if (frame.type === "ECHO" && frame.reply === true && typeof frame.id === "number") {
        const sent = pending.get(frame.id);
        if (sent !== undefined) {
          rtts.push(performance.now() - sent);
          if (rtts.length > 1800) rtts.shift();
          pending.delete(frame.id);
        }
      }
      if (frame.type === "PEER" && frame.connected !== true) {
        rtc?.dispose();
        input = neutral();
        receivedAt = -Infinity;
      }
    };
    link.onclose = () => {
      rtc?.dispose();
      input = neutral();
      receivedAt = -Infinity;
      element("status").textContent = "Sesión cerrada. Crea otro enlace.";
    };
    const invite = new URL("/probe/controller/", location.origin);
    invite.hash = new URLSearchParams({
      relay: base.origin,
      id: keys.id,
      token: keys.controllerToken,
    }).toString();
    const qr = qrcode(0, "M");
    qr.addData(invite.href);
    qr.make();
    element("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    const anchor = element<HTMLAnchorElement>("invite");
    anchor.href = invite.href;
    anchor.hidden = false;
    inviteUntil = keys.inviteUntil;
    element("status").textContent = "Esperando al teléfono";
  } catch (error) {
    element("error").textContent = error instanceof Error ? error.message : "Error de conexión";
  } finally {
    element<HTMLButtonElement>("new").disabled = false;
  }
};
let hudTick = 0;
const watchdog = setInterval(() => {
  const now = performance.now();
  const age = now - receivedAt;
  const paused = !link?.connected || expiredInput(receivedAt, now) || document.hidden;
  if (paused && !wasStale && frames) stale++;
  wasStale = paused;
  const safe = paused || age >= 150 ? neutral() : input;
  element("viewport").dispatchEvent(
    new CustomEvent("probe-input", { detail: { ...safe, paused, receivedAt } }),
  );
  if (++hudTick % 4 !== 0) return;
  element("meter").textContent = paused
    ? "PAUSA SEGURA"
    : `${safe.steer.toFixed(2)} · GAS ${safe.throttle.toFixed(1)} · FRENO ${safe.brake.toFixed(1)}`;
  element("metrics").textContent =
    `RTT ${rtts.length ? `${Math.round(rtts.at(-1) ?? 0)} ms` : "—"} · ${frames} entradas · ${stale} pausas`;
  if (link?.connected) {
    element("status").textContent = paused
      ? "Mando enlazado · esperando entrada"
      : "Mando activo / WSS";
    element("qr").hidden = true;
  } else {
    element("qr").hidden = joined || (inviteUntil > 0 && Date.now() >= inviteUntil);
    if (link?.ready && joined)
      element("status").textContent = "Mando desconectado. Crea otro enlace.";
    else if (link?.ready && inviteUntil && Date.now() >= inviteUntil)
      element("status").textContent = "Invitación caducada. Crea otro enlace.";
  }
  element("expiry").textContent = inviteUntil
    ? `Invitación: ${Math.max(0, Math.ceil((inviteUntil - Date.now()) / 1000))} s`
    : "";
}, 25);
const heartbeat = setInterval(() => {
  if (link?.connected) {
    const id = ++ping;
    pending.set(id, performance.now());
    link.send({ type: "ECHO", id, reply: false });
  }
  for (const [id, sent] of pending) if (performance.now() - sent > 5000) pending.delete(id);
}, 1000);
element("export").onclick = () => {
  const sorted = [...rtts].sort((a, b) => a - b);
  exportReport({
    experiment: "F02",
    durationMs: performance.now() - startedAt,
    frames,
    sequenceGaps: gaps,
    stalePauses: stale,
    rttSamples: rtts.length,
    rtc: rtc?.report ?? null,
    graphics: graphics?.report() ?? null,
    rttP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
    note: "RTT de aplicación PC-relay-móvil-relay-PC; huecos de secuencia no equivalen a pérdida IP.",
  });
};
window.addEventListener("pagehide", () => {
  pageLeft = true;
  graphics?.dispose();
  clearInterval(watchdog);
  clearInterval(heartbeat);
  link?.close();
  rtc?.dispose();
});
