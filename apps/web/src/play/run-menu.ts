import { progressStore } from "../storage/database.ts";
import { addResult, summarize, newRunId } from "../storage/model.ts";
import {
  createRace,
  driving,
  MODES,
  objectives,
  PAINTS,
  type Mode,
  type Race,
  unlockedPaints,
} from "@qracer/game-core";
import { BIOMES, type Biome } from "./biomes.ts";
import "./run-menu.css";

export const modeNames = {
  infinite: "Infinito",
  practice: "Práctica",
  "time-trial": "Contrarreloj",
  daily: "Desafío diario",
};
const paintColors = [0xffcb47, 0x72cce3, 0xe47e72, 0x58af88, 0x987ed0, 0x68757e];

export function mountRunMenu(root: HTMLElement, changed: () => void) {
  const shell = document.createElement("section");
  shell.className = "run-selection";
  shell.setAttribute("aria-label", "Configura tu recorrido");
  shell.innerHTML = `
    <p class="run-eyebrow">Una carretera. Tu siguiente desafío.</p>
    <div class="run-fields">
      <label>Modo<select id="run-mode"><option value="infinite">Infinito</option><option value="practice">Práctica</option><option value="time-trial">Contrarreloj · 120 s</option><option value="daily">Desafío diario · 120 s</option></select></label>
      <label>Salida<select id="run-biome"><option value="coast">Costa</option><option value="desert">Desierto</option><option value="city">Ciudad nocturna</option></select></label>
      <label>Semilla<input id="run-seed" type="number" min="-2147483648" max="2147483647" step="1" value="310"></label>
      <label>Pintura<select id="run-paint"></select></label>
    </div>
    <p id="storage-status" class="fine-print" role="status"></p>
    <p id="run-description" class="fine-print"></p>
    <details><summary>Objetivos y pinturas</summary><div id="run-objectives"></div>
      <p class="fine-print">Progreso local en este navegador. El modo privado o borrar datos puede eliminarlo. Las pinturas son cosméticas.</p>
    </details>`;
  root.querySelector(".race-menu > section")?.append(shell);
  const field = <T extends HTMLElement>(id: string) => {
    const node = shell.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing ${id}`);
    return node;
  };
  const mode = field<HTMLSelectElement>("run-mode");
  const biome = field<HTMLSelectElement>("run-biome");
  const seed = field<HTMLInputElement>("run-seed");
  const paint = field<HTMLSelectElement>("run-paint");
  const description = field("run-description");
  let progress = progressStore.data.progress;
  let runId = newRunId();
  function currentMode(): Mode {
    return MODES.find((key) => key === mode.value) ?? "infinite";
  }
  function currentBiome(): Biome {
    return BIOMES.find((key) => key === biome.value) ?? "coast";
  }
  function redraw() {
    const selected = currentMode();
    seed.disabled = selected === "daily";
    description.textContent =
      selected === "practice"
        ? "Aprende sin perder integridad. Puedes terminar la práctica cuando quieras. No concede récords ni pinturas."
        : selected === "daily"
          ? `Reto recreativo del ${new Date().toISOString().slice(0, 10)} UTC. Misma semilla y reglas durante el día. Sin clasificación global.`
          : selected === "time-trial"
            ? "Suma puntos durante 120 segundos de conducción. El reloj se detiene al pausar."
            : "Conduce mientras tengas integridad. La dificultad crece con un límite y conserva una ruta segura.";
    const unlocked = unlockedPaints(progress);
    const saved = paint.value;
    paint.replaceChildren(
      ...PAINTS.map((label, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = unlocked[index] ? label : `${label} · bloqueada`;
        option.disabled = !unlocked[index];
        return option;
      }),
    );
    if (unlocked[Number(saved)]) paint.value = saved || "0";
    const target = field("run-objectives");
    target.replaceChildren();
    for (const objective of objectives(progress)) {
      const line = document.createElement("p");
      line.textContent = `${objective.current >= objective.target ? "★" : "○"} ${objective.label} · ${Math.min(objective.current, objective.target)} / ${objective.target}`;
      target.append(line);
    }
    const title = root.querySelector(".race-title-accent");
    if (title)
      title.textContent = { coast: "costero", desert: "del desierto", city: "nocturno" }[
        currentBiome()
      ];
  }
  mode.onchange = redraw;
  biome.onchange = () => {
    redraw();
    changed();
  };
  const refresh = () => {
    progress = progressStore.data.progress;
    field("storage-status").textContent = {
      saved: "Progreso guardado en este navegador.",
      memory: "Almacenamiento no disponible. Esta partida continúa en memoria.",
      corrupt: "Se aislaron datos dañados y se recuperaron valores seguros.",
      future:
        "Datos de una versión nueva: se conservan sin sobrescribir. Esta pestaña usa memoria.",
    }[progressStore.status];
    root.dataset.storage = progressStore.status;
    redraw();
  };
  progressStore.subscribe(refresh);
  const ready = progressStore.ready.then(refresh);
  redraw();
  return {
    ready,
    biome: currentBiome,
    paint: () =>
      unlockedPaints(progress)[Number(paint.value)]
        ? (paintColors[Number(paint.value)] ?? paintColors[0] ?? 0xffcb47)
        : 0xffcb47,
    create() {
      runId = newRunId();
      const value = Number(seed.value);
      return createRace(
        Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : 310,
        driving,
        { mode: currentMode() },
      );
    },
    finish(race: Race, assisted: boolean) {
      const run = assisted
        ? {
            ...race.run,
            assisted: true,
            category: race.run.category.replace(/standard$/, "assisted"),
          }
        : race.run;
      const before = unlockedPaints(progress);
      const row = summarize(runId, { ...race, run });
      progress = addResult({ ...progressStore.data, progress }, row).progress;
      void progressStore.commit(row);
      const unlocked = PAINTS.filter(
        (_, index) => !before[index] && unlockedPaints(progress)[index],
      );
      redraw();
      return `${modeNames[run.mode]}${run.day ? ` · ${run.day} UTC` : ""} · ${run.competitive ? `Récord local: ${progress.records[run.category] ?? 0}` : "Sin récord competitivo"}${unlocked.length ? ` · Pinturas nuevas: ${unlocked.join(", ")}` : ""}`;
    },
  };
}
