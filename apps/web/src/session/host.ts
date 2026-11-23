import type { DriveFrame, ServerFrame } from "@qracer/session-core/wire";
import qrcode from "qrcode-generator";
import { controllerUrl, createSession, SessionLink, sessionError } from "./link.ts";

type State = Extract<ServerFrame, { type: "STATE" }>;

export function mountPairing(
  trigger: HTMLButtonElement,
  driving: {
    connection: (epoch?: number, send?: (frame: DriveFrame) => boolean) => void;
    message: (frame: DriveFrame) => void;
  },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "pair-dialog race-controls";
  dialog.setAttribute("aria-labelledby", "pair-title");
  dialog.innerHTML = `
    <form method="dialog" class="pair-header">
      <h2 id="pair-title">Conecta tu móvil</h2>
      <button type="submit" class="button" aria-label="Cerrar panel">Cerrar</button>
    </form>
    <p id="host-pair-status" role="status">Genera una invitación para vincular un dispositivo.</p>
    <div id="host-invite" hidden>
      <div id="host-qr" class="pair-qr" role="img" aria-label="Código QR de invitación"></div>
      <p id="invite-time"></p>
      <div class="pair-form">
        <label for="host-link">Enlace de uso único</label>
        <input id="host-link" readonly autocomplete="off" spellcheck="false">
        <button type="button" class="button" id="pair-copy">Copiar enlace</button>
      </div>
      <p id="pair-note" role="status"></p>
    </div>
    <div id="host-confirm" hidden>
      <p>Comprueba que este código coincide con el del móvil.</p>
      <output class="pair-code" id="host-pair-code" aria-label="Código de comprobación"></output>
      <div class="pair-actions">
        <button type="button" class="button primary" id="pair-approve">Aprobar mando</button>
        <button type="button" class="button" id="pair-reject">Rechazar</button>
      </div>
    </div>
    <div class="pair-actions">
      <button type="button" class="button primary" id="pair-generate">Generar invitación</button>
      <button type="button" class="button" id="pair-revoke" hidden>Revocar mando</button>
      <button type="button" class="button" id="pair-end" hidden>Cerrar sala</button>
    </div>`;
  document.body.append(dialog);

  function element<T extends HTMLElement>(id: string): T {
    const node = dialog.querySelector<HTMLElement>(`#${id}`);
    if (!node) throw new Error(`Missing #${id}`);
    return node as T;
  }

  const status = element("host-pair-status");
  const invite = element("host-invite");
  const qr = element("host-qr");
  const note = element("pair-note");
  const time = element("invite-time");
  const linkField = element<HTMLInputElement>("host-link");
  const confirm = element("host-confirm");
  const code = element<HTMLOutputElement>("host-pair-code");
  const generate = element<HTMLButtonElement>("pair-generate");
  const approve = element<HTMLButtonElement>("pair-approve");
  const revoke = element<HTMLButtonElement>("pair-revoke");
  const end = element<HTMLButtonElement>("pair-end");
  let pendingFetch: AbortController | undefined;
  let session: SessionLink | undefined;
  let state: State | undefined;
  let expires = 0;
  let timer = 0;
  let firstInvite = false;

  function clearInvite() {
    expires = 0;
    window.clearTimeout(timer);
    invite.hidden = true;
    qr.replaceChildren();
    linkField.value = "";
    note.textContent = "";
  }

  function countdown() {
    window.clearTimeout(timer);
    if (!expires) return;
    const seconds = Math.max(0, Math.ceil((expires - performance.now()) / 1000));
    if (!seconds) {
      clearInvite();
      status.textContent = "La invitación caducó. Genera otra.";
    } else {
      time.textContent = `Caduca en ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      if (dialog.open) timer = window.setTimeout(countdown, 250);
    }
  }

  function render() {
    generate.hidden = Boolean(state?.request);
    generate.disabled = Boolean(pendingFetch || (session && !state));
    generate.textContent = state?.linked ? "Invitar otro móvil" : "Generar invitación";
    revoke.hidden = !state?.linked;
    end.hidden = !session && !pendingFetch;
    confirm.hidden = !state?.request;
    approve.textContent = state?.linked ? "Aprobar sustitución" : "Aprobar mando";
    code.value = state?.code ?? "";
    trigger.textContent = state?.phase === "connected" ? "Mando vinculado" : "Conectar móvil";
    if (state) dialog.dataset.epoch = String(state.epoch);
    else delete dialog.dataset.epoch;
  }

  function reset(message: string) {
    driving.connection();
    pendingFetch?.abort();
    pendingFetch = undefined;
    session?.dispose();
    session = undefined;
    state = undefined;
    firstInvite = false;
    clearInvite();
    status.textContent = message;
    render();
  }

  function showInvite(frame: Extract<ServerFrame, { type: "INVITE" }>, room: string) {
    linkField.value = controllerUrl({ room, token: frame.token });
    const loopback = /^(localhost$|127\.|\[::1\]$)/.test(location.hostname);
    qr.hidden = loopback;
    if (!loopback) {
      const matrix = qrcode(0, "M");
      matrix.addData(linkField.value);
      matrix.make();
      qr.innerHTML = matrix.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    }
    note.textContent = loopback
      ? "Esta dirección solo abre en la PC. Abre QRacer con la IP de la PC en la misma red para obtener un QR que pueda escanear el móvil."
      : "Escanea desde la cámara del móvil o abre /controller/ y pega el enlace.";
    invite.hidden = false;
    expires = performance.now() + frame.ttl;
    countdown();
  }

  function handle(frame: ServerFrame, room: string) {
    if (frame.type === "ERROR") {
      status.textContent = sessionError(frame.code);
      return;
    }
    if (frame.type === "INVITE") {
      showInvite(frame, room);
      status.textContent = "Invitación lista. Esperando un móvil.";
      return;
    }
    if (frame.type !== "STATE") {
      if ("epoch" in frame) driving.message(frame);
      return;
    }
    if (frame.phase === "connected")
      driving.connection(frame.epoch, (packet) => session?.send(packet) ?? false);
    else driving.connection();
    state = frame;
    if (frame.phase === "pending") {
      clearInvite();
      status.textContent = "Un móvil solicita acceso.";
    } else if (frame.phase === "connected")
      status.textContent = expires
        ? "El mando actual sigue vinculado hasta aprobar un sustituto."
        : "Mando vinculado.";
    else if (frame.phase === "reconnecting")
      status.textContent = "Mando desconectado. Puede volver durante 30 segundos.";
    else
      status.textContent = expires
        ? "Invitación lista. Esperando un móvil."
        : "Genera una invitación para vincular un dispositivo.";
    render();
    if (firstInvite) {
      firstInvite = false;
      session?.send({ type: "ROTATE" });
    }
  }

  async function generateInvite() {
    if (state) {
      if (!session?.send({ type: "ROTATE" })) status.textContent = "La sala se está reconectando.";
      return;
    }
    if (session || pendingFetch) return;
    const request = new AbortController();
    pendingFetch = request;
    const deadline = window.setTimeout(() => request.abort(), 6000);
    status.textContent = "Creando sala…";
    render();
    try {
      const created = await createSession(request.signal);
      if (pendingFetch !== request) return;
      firstInvite = true;
      session = new SessionLink({ room: created.room, token: created.hostToken }, "host", {
        frame: (frame) => handle(frame, created.room),
        reconnecting() {
          driving.connection();
          state = undefined;
          clearInvite();
          status.textContent = "Reconectando con la sala…";
          render();
        },
        ended: reset,
      });
      session.open();
    } catch (error) {
      if (pendingFetch !== request) return;
      reset(
        error instanceof TypeError || request.signal.aborted
          ? "No se pudo conectar con el relay. Intenta de nuevo."
          : error instanceof Error
            ? error.message
            : "No se pudo crear la sala.",
      );
    } finally {
      window.clearTimeout(deadline);
      if (pendingFetch === request) pendingFetch = undefined;
      render();
    }
  }

  trigger.onclick = () => {
    dialog.showModal();
    countdown();
  };
  dialog.addEventListener("close", () => {
    window.clearTimeout(timer);
    trigger.focus();
  });
  generate.onclick = () => {
    void generateInvite();
  };
  approve.onclick = () => {
    if (state?.request) session?.send({ type: "APPROVE", request: state.request });
  };
  element("pair-reject").onclick = () => {
    if (state?.request) session?.send({ type: "REJECT", request: state.request });
  };
  revoke.onclick = () => {
    clearInvite();
    session?.send({ type: "REVOKE" });
  };
  end.onclick = () => {
    session?.dispose(true);
    reset("Sala cerrada. Puedes crear otra invitación.");
  };
  element("pair-copy").onclick = async () => {
    if (!linkField.value) return;
    try {
      await navigator.clipboard.writeText(linkField.value);
      if (!invite.hidden) note.textContent = "Enlace copiado.";
    } catch {
      linkField.focus();
      linkField.select();
      note.textContent = "Enlace seleccionado. Cópialo desde tu navegador.";
    }
  };
  window.addEventListener("pagehide", () => {
    session?.dispose(true);
    reset("Genera una invitación para vincular un dispositivo.");
    if (dialog.open) dialog.close();
  });
}
