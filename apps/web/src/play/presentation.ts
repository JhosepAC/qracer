import { mountKeyboard } from "./keyboard.ts";
import { readPresentation, savePresentation } from "./preferences.ts";
import type { RaceAudio } from "./audio.ts";
import "./presentation.css";

export function mountPresentation(audio: RaceAudio, onOpen: () => void) {
  const settings = readPresentation();
  audio.configure(settings);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = "presentation-open";
  trigger.textContent = "Sonido y comodidad";
  const dialog = document.createElement("dialog");
  dialog.className = "presentation-dialog";
  dialog.setAttribute("aria-labelledby", "presentation-title");
  dialog.innerHTML = `<form method="dialog"><h2 id="presentation-title">Sonido y comodidad</h2>
    <label><input id="audio-muted" type="checkbox"> Silencio</label>
    <label for="audio-master">Volumen general <output id="audio-master-value"></output></label><input id="audio-master" type="range" min="0" max="100" step="1">
    <label for="audio-music">Música <output id="audio-music-value"></output></label><input id="audio-music" type="range" min="0" max="100" step="1">
    <label for="audio-effects">Motor y efectos <output id="audio-effects-value"></output></label><input id="audio-effects" type="range" min="0" max="100" step="1">
    <p class="fine-print">El sonido se activa al jugar. Puedes jugar completamente en silencio.</p>
    <p id="audio-status" role="status"></p>
    <div id="comfort-options"></div>
    <button type="submit" class="button">Cerrar ajustes</button></form>`;
  document.body.append(dialog);
  document.querySelector(".race-bar")?.append(trigger);
  const field = <T extends HTMLElement>(id: string) => {
    const node = dialog.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`Missing ${id}`);
    return node;
  };
  const muted = field<HTMLInputElement>("audio-muted");
  muted.checked = settings.muted;
  function apply() {
    audio.configure(settings);
    savePresentation(settings);
  }
  for (const key of ["master", "music", "effects"] as const) {
    const input = field<HTMLInputElement>(`audio-${key}`);
    const output = field(`audio-${key}-value`);
    input.value = String(Math.round(settings[key] * 100));
    output.textContent = `${input.value}%`;
    input.oninput = () => {
      settings[key] = Number(input.value) / 100;
      output.textContent = `${input.value}%`;
      apply();
    };
  }
  const comfort = field("comfort-options");
  comfort.innerHTML = `<fieldset><legend>Comodidad</legend>
    <label><input type="checkbox" id="comfort-stableCamera"> Cámara estable</label>
    <label><input type="checkbox" id="comfort-reducedMotion"> Reducir movimiento</label>
    <label><input type="checkbox" id="comfort-reducedFlashes"> Reducir flashes</label>
    <label><input type="checkbox" id="comfort-assisted"> Conducción asistida con teclado</label>
    <p class="fine-print">La asistencia reduce dirección y aceleración y separa los récords. Las preferencias del sistema pueden reducir el movimiento.</p>
    <div id="keyboard-options"></div></fieldset>`;
  for (const key of ["stableCamera", "reducedMotion", "reducedFlashes", "assisted"] as const) {
    const input = field<HTMLInputElement>(`comfort-${key}`);
    input.checked = settings[key];
    input.onchange = () => {
      settings[key] = input.checked;
      apply();
    };
  }
  mountKeyboard(field("keyboard-options"), settings.bindings, apply);
  muted.onchange = () => {
    settings.muted = muted.checked;
    apply();
  };
  trigger.onclick = () => {
    onOpen();
    audio.menu();
    field("audio-status").textContent =
      audio.diagnostics.state === "no disponible"
        ? "Audio no disponible. Puedes seguir jugando en silencio."
        : "Audio original · motor, música y efectos independientes.";
    dialog.showModal();
  };
  dialog.addEventListener("close", () => trigger.focus());
  return { settings, dialog, apply };
}
