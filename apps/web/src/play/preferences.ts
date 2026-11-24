import { readBindings, type Bindings } from "./keyboard.ts";
import { audioSettings, type AudioSettings } from "./audio-settings.ts";

const key = "qracer.presentation.v1";
export interface Presentation extends AudioSettings {
  bindings: Bindings;
  stableCamera: boolean;
  reducedMotion: boolean;
  reducedFlashes: boolean;
  assisted: boolean;
}
export function readPresentation(): Presentation {
  let saved: Record<string, unknown> = {};
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (value && typeof value === "object") saved = value;
  } catch {
    /* Defaults remain usable. */
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    ...audioSettings(saved),
    bindings: readBindings(saved.bindings),
    stableCamera: saved.stableCamera === true,
    reducedMotion: saved.reducedMotion === true || reduced,
    reducedFlashes: saved.reducedFlashes === true || reduced,
    assisted: saved.assisted === true,
  };
}
export function savePresentation(value: Presentation) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Keep preferences in this tab. */
  }
}
