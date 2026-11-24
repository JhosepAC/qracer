import { progressStore } from "../storage/database.ts";
import { categoryInfo, DataFault, MAX_IMPORT } from "../storage/model.ts";
import { exportProgress, parseProgress } from "../storage/transfer.ts";
import { confirmAction } from "../ui/confirm.ts";
import { modeNames } from "./run-menu.ts";

export function mountDataMenu(onOpen: () => void) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "button";
  trigger.textContent = "Datos locales";
  document.querySelector(".race-controls")?.append(trigger);
  const dialog = document.createElement("dialog");
  dialog.className = "presentation-dialog data-dialog";
  dialog.setAttribute("aria-labelledby", "data-title");
  dialog.innerHTML = `<form method="dialog"><h2 id="data-title">Datos locales</h2>
    <p>Los datos pertenecen a este navegador. El modo privado o borrar sus datos puede eliminarlos. Exporta una copia para conservarlos.</p>
    <p id="data-status" role="status"></p><p id="data-counts"></p>
    <button type="button" id="data-export">Exportar progreso</button>
    <label>Importar progreso (JSON, máximo 1 MiB)<input type="file" id="data-import" accept=".json,application/json"></label>
    <button type="button" id="data-recovery">Exportar copia de recuperación</button>
    <details><summary>Récords locales</summary><div id="data-records"></div></details>
    <details><summary>Últimas partidas</summary><div id="data-history"></div></details>
    <button type="button" id="data-reset">Borrar progreso y fantasmas</button>
    <button type="button" id="data-preferences">Restablecer ajustes de PC</button>
    <button type="submit">Cerrar datos</button></form>`;
  document.body.append(dialog);
  const field = <T extends HTMLElement>(id: string) => {
    const node = dialog.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing ${id}`);
    return node;
  };
  const status = field("data-status");
  let busy = false;
  const message = (error: unknown) =>
    error instanceof DataFault && error.reason === "future"
      ? "Estos datos necesitan una versión más reciente. Se conservan los originales."
      : "No se pudo completar la operación. Revisa el almacenamiento del navegador.";
  function download(text: string, name: string) {
    if (new TextEncoder().encode(text).byteLength > MAX_IMPORT) throw new DataFault("corrupt");
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function refresh() {
    const data = progressStore.data;
    field("data-counts").textContent =
      `${data.progress.distance} m · Récords: ${Object.keys(data.progress.records).length} · Partidas: ${data.history.length}`;
    field("data-records").replaceChildren();
    field("data-history").replaceChildren();
    for (const [key, score] of Object.entries(data.progress.records).sort((a, b) => b[1] - a[1])) {
      const info = categoryInfo(key);
      if (!info) continue;
      const p = document.createElement("p");
      p.textContent = `${modeNames[info.mode]} · ${score} puntos · #${info.seed}${info.assisted ? " · asistida" : ""}`;
      field("data-records").append(p);
    }
    for (const row of data.history) {
      const p = document.createElement("p");
      p.textContent = `${new Date(row.ended).toISOString().slice(0, 10)} · ${modeNames[row.mode]} · ${row.score} puntos`;
      field("data-history").append(p);
    }
  }
  async function run(action: () => Promise<void> | void) {
    if (busy) return;
    const previous = document.activeElement;
    busy = true;
    for (const node of dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "input,button",
    ))
      node.disabled = true;
    try {
      await action();
      refresh();
    } catch (error) {
      status.textContent = message(error);
    } finally {
      busy = false;
      for (const node of dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input,button",
      ))
        node.disabled = false;
      if (dialog.open && previous instanceof HTMLElement) previous.focus();
    }
  }
  field("data-export").onclick = () => {
    void run(() => {
      download(exportProgress(progressStore.data), "qracer-progress.json");
      status.textContent = "Copia de progreso descargada.";
    });
  };
  field("data-recovery").onclick = () => {
    void run(async () => {
      const backup = await progressStore.recovery();
      if (backup === undefined) {
        status.textContent = "No hay copia de recuperación disponible.";
        return;
      }
      download(
        JSON.stringify({ app: "QRacer-recovery", data: backup }, null, 2),
        "qracer-recovery.json",
      );
      status.textContent =
        "Copia de recuperación descargada. Consérvala para una versión compatible.";
    });
  };
  const input = field<HTMLInputElement>("data-import");
  input.onchange = () => {
    void run(async () => {
      const file = input.files?.[0];
      if (!file) return;
      let validated = false;
      try {
        if (file.size > MAX_IMPORT) throw new DataFault("corrupt");
        const next = parseProgress(await file.text());
        const old = progressStore.data.progress;
        if (
          !(await confirmAction(
            "Reemplazar progreso",
            `Récords: ${Object.keys(old.records).length} → ${Object.keys(next.progress.records).length}. Distancia: ${old.distance} → ${next.progress.distance} m. Se eliminarán los fantasmas anteriores.`,
          ))
        )
          return;
        validated = true;
        await progressStore.replace(next);
        status.textContent =
          progressStore.status === "saved"
            ? "Progreso importado."
            : "Progreso importado en memoria. El navegador no permite guardarlo.";
      } catch (error) {
        status.textContent =
          validated || (error instanceof DataFault && error.reason === "future")
            ? message(error)
            : "Archivo inválido o mayor de 1 MiB. Se conserva el progreso actual.";
      } finally {
        input.value = "";
      }
    });
  };
  field("data-reset").onclick = () => {
    void run(async () => {
      if (
        !(await confirmAction(
          "Borrar progreso y fantasmas",
          "Se borrarán récords, objetivos, partidas y fantasmas de este navegador. Exporta antes una copia si quieres conservarlos.",
        ))
      )
        return;
      await progressStore.reset();
      status.textContent = "Progreso borrado.";
    });
  };
  field("data-preferences").onclick = () => {
    void run(async () => {
      if (
        !(await confirmAction(
          "Restablecer ajustes de PC",
          "Se restaurarán gráficos, sonido, comodidad y teclas. Conservarás tu progreso.",
        ))
      )
        return;
      for (const key of ["qracer.graphics.quality", "qracer.presentation.v1", "qracer.locale.v1"])
        localStorage.removeItem(key);
      location.reload();
    });
  };
  progressStore.subscribe(refresh);
  trigger.onclick = () => {
    onOpen();
    refresh();
    status.textContent = "";
    dialog.showModal();
  };
  dialog.addEventListener("close", () => trigger.focus());
}
