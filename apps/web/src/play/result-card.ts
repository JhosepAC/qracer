import type { Race } from "@qracer/game-core";
import { translateText } from "../i18n/messages.ts";
import { modeNames } from "./run-menu.ts";

/** Initiate the snapshot in the same turn as WebGL draw, before its buffer is discarded. */
export function snapshot(canvas?: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((done) => {
    try {
      if (canvas) canvas.toBlob(done, "image/png");
      else done(null);
    } catch {
      done(null);
    }
  });
}

async function renderCard(race: Race, assisted: boolean, image: Blob | null) {
  await Promise.all([
    document.fonts.load("700 96px Rajdhani"),
    document.fonts.load("600 24px Barlow"),
  ]).catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#10171b";
  ctx.fillRect(0, 0, 1280, 720);
  if (image) {
    try {
      const bitmap = await createImageBitmap(image);
      const scale = Math.max(1280 / bitmap.width, 720 / bitmap.height);
      ctx.drawImage(
        bitmap,
        (1280 - bitmap.width * scale) / 2,
        (720 - bitmap.height * scale) / 2,
        bitmap.width * scale,
        bitmap.height * scale,
      );
      bitmap.close();
    } catch {
      /* A local graphic background remains usable if the GPU snapshot is unavailable. */
    }
  }
  const shade = ctx.createLinearGradient(0, 0, 1280, 450);
  shade.addColorStop(0, "#10171bf5");
  shade.addColorStop(1, "#10171b85");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#ffcb47";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(16, 0);
  ctx.lineTo(16, 720);
  ctx.lineTo(0, 720);
  ctx.fill();
  const locale = document.documentElement.lang === "en" ? "en" : "es";
  const t = (value: string) => translateText(value, locale);
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color = "#f3f6f3",
    width = 1120,
  ) => {
    ctx.font = `700 ${size}px Rajdhani, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y, width);
  };
  text("QRacer", 64, 96, 68, "#ffcb47");
  text(t("Fin de carrera"), 64, 148, 30);
  text(`${t(modeNames[race.run.mode])}  /  ${t("Semilla")} ${race.seed}`, 64, 204, 30, "#c5d3d4");
  text(String(race.score), 64, 348, 132, "#ffcb47");
  text(t("Puntos").toUpperCase(), 68, 386, 26);
  text(
    t(assisted || race.run.assisted ? "Carrera asistida" : "Conducción estándar"),
    68,
    432,
    28,
    "#67e8db",
  );
  ctx.fillStyle = "#10171be8";
  ctx.fillRect(48, 486, 1184, 142);
  const stats = [
    ["Distancia", `${Math.floor(race.driver.s)} m`],
    ["Velocidad máxima", `${Math.round(race.topSpeed * 3.6)} km/h`],
    ["Adelantamientos", String(race.overtakes)],
    ["Casi accidentes", String(race.nearMisses)],
  ];
  stats.forEach(([label = "", value = ""], index) => {
    const x = 70 + index * 294;
    text(t(label), x, 528, 24, "#c5d3d4", 264);
    text(value, x, 590, 48, "#f3f6f3", 264);
  });
  text(t("Tu carrera. Tu récord."), 64, 678, 26, "#c5d3d4");
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG unavailable"))),
      "image/png",
    ),
  );
}

export function mountResultCard() {
  const section = document.createElement("section");
  section.hidden = true;
  section.innerHTML = `<button type="button" id="download-card" disabled>Descargar tarjeta PNG</button><button type="button" id="share-card" hidden disabled>Compartir tarjeta</button><p id="card-status" class="fine-print" role="status"></p>`;
  document.getElementById("overlay")?.append(section);
  const download = section.querySelector<HTMLButtonElement>("#download-card");
  const share = section.querySelector<HTMLButtonElement>("#share-card");
  const status = section.querySelector<HTMLParagraphElement>("#card-status");
  if (!download || !share || !status) throw new Error("Missing card controls");
  let generation = 0;
  let file: File | undefined;
  let current: { race: Race; assisted: boolean; image: Promise<Blob | null> } | undefined;
  const prepare = async () => {
    const token = ++generation;
    file = undefined;
    download.disabled = share.disabled = true;
    share.hidden = true;
    status.textContent = "Preparando tarjeta…";
    const result = current;
    if (!result) return;
    try {
      const blob = await renderCard(result.race, result.assisted, await result.image);
      if (token !== generation) return;
      file = new File([blob], "qracer-carrera.png", { type: "image/png" });
      download.disabled = false;
      share.hidden = !navigator.canShare?.({ files: [file] }) || !navigator.share;
      share.disabled = false;
      status.textContent = "Tarjeta lista. Se genera en este dispositivo.";
    } catch {
      if (token === generation)
        status.textContent = "No se pudo crear la imagen. El resumen de carrera sigue disponible.";
    }
  };
  download.onclick = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  share.onclick = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "QRacer" });
      status.textContent = "Tarjeta compartida.";
    } catch (error) {
      status.textContent =
        error instanceof DOMException && error.name === "AbortError"
          ? "Compartir cancelado. Puedes descargar la tarjeta."
          : "No se pudo compartir. Descarga la tarjeta PNG.";
    }
  };
  document.addEventListener("qracer:locale", () => {
    if (current) void prepare();
  });
  return {
    show(race: Race, assisted: boolean, image: Promise<Blob | null>) {
      current = { race, assisted, image };
      section.hidden = false;
      void prepare();
    },
    clear() {
      generation++;
      current = undefined;
      file = undefined;
      section.hidden = true;
    },
  };
}
