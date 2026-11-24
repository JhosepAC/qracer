import {
  connectOffline,
  downloadWorlds,
  offlineEnabled,
  offlineStatus,
  prepareOffline,
  supported,
  updateBlocked,
  updateWaiting,
  applyUpdate,
} from "./client.ts";

export function mountOffline() {
  const panel = document.createElement("details");
  panel.id = "offline-menu";
  panel.innerHTML = `<summary>Jugar sin conexión</summary><p class="fine-print">Teclado sin Internet tras descargar el circuito. Vincular un móvil requiere relay y red disponibles.</p><p id="offline-status" class="fine-print" role="status"></p><p id="offline-worlds" class="fine-print"></p><button type="button" id="offline-prepare">Preparar juego sin conexión</button><button type="button" id="offline-download">Descargar todos los entornos</button><button type="button" id="offline-update" hidden>Aplicar actualización</button>`;
  document.querySelector(".race-menu .race-controls")?.append(panel);
  function field<T extends HTMLElement>(id: string) {
    const node = panel.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing ${id}`);
    return node;
  }
  const status = field("offline-status"),
    worlds = field("offline-worlds");
  const prepare = field<HTMLButtonElement>("offline-prepare"),
    download = field<HTMLButtonElement>("offline-download"),
    update = field<HTMLButtonElement>("offline-update");
  let busy = false;
  let notice = "";
  async function refresh() {
    update.hidden = !updateWaiting();
    prepare.disabled = download.disabled = update.disabled = busy || !supported || updateBlocked();
    if (!supported) {
      status.textContent =
        "Sin conexión requiere HTTPS de confianza o localhost. Puedes seguir jugando con red.";
      return;
    }
    if (updateBlocked()) {
      status.textContent = "Actualización en curso. La carrera estará disponible enseguida.";
      return;
    }
    if (!offlineEnabled()) {
      download.disabled = true;
      status.textContent = "Descargas desactivadas. Tu progreso se conserva.";
      worlds.textContent = "";
      return;
    }
    try {
      const data = await offlineStatus();
      if (busy) return;
      status.textContent =
        notice ||
        (data?.ready
          ? "Circuito costero disponible sin conexión con teclado."
          : "Descarga pendiente. Mantén la red hasta que el circuito esté disponible.");
      const available = Array.isArray(data?.available) ? data.available : [];
      worlds.textContent = `${available.includes("/assets/world/desert.glb") ? "Desierto descargado" : "Desierto no descargado"} · ${available.includes("/assets/world/city.glb") ? "Ciudad descargada" : "Ciudad no descargada"}`;
      download.disabled = !data?.ready;
    } catch {
      download.disabled = true;
      status.textContent = "No se pudo preparar la descarga. Puedes jugar con red y reintentar.";
    }
  }
  async function action(run: () => Promise<unknown>) {
    notice = "";
    busy = true;
    void refresh();
    status.textContent = "Preparando descarga…";
    try {
      await run();
      busy = false;
      await refresh();
    } catch {
      busy = false;
      await refresh();
      status.textContent =
        "No se pudo completar la descarga. Revisa la red y el espacio del navegador.";
    }
  }
  prepare.onclick = () => void action(prepareOffline);
  download.onclick = () => void action(downloadWorlds);
  update.onclick = () =>
    void action(async () => {
      if (!(await applyUpdate()))
        notice = "Vuelve al menú en las otras pestañas de PC o ciérralas antes de actualizar.";
    });
  panel.ontoggle = () => {
    if (panel.open) void refresh();
  };
  document.addEventListener("qracer:offline", () => void refresh());
  window.addEventListener("online", () => void refresh());
  window.addEventListener("offline", () => void refresh());
  void refresh();
  return {
    refresh,
    start() {
      void connectOffline()
        .then(refresh)
        .catch(() => {
          status.textContent =
            "No se pudo preparar la descarga. Puedes jugar con red y reintentar.";
        });
    },
  };
}
