import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createRace } from "../../packages/game-core/src/race.ts";
import { freshData } from "../../apps/web/src/storage/model.ts";
import { exportProgress } from "../../apps/web/src/storage/transfer.ts";

test("confirms replacement/deletion, rejects unsafe files and preserves data across reloads", async ({
  page,
}, info) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container){const canvas=document.createElement("canvas");container.append(canvas);return {canvas,draw(){},stats:()=>({}),dispose(){canvas.remove()}};}`,
    }),
  );
  await page.goto("/play/");
  await expect(page.locator("#app")).toHaveAttribute("data-storage", "saved");
  await page.getByRole("button", { name: "Datos locales", exact: true }).click();
  const data = page.getByRole("dialog", { name: "Datos locales", exact: true });
  const profile = freshData();
  profile.progress = {
    ...profile.progress,
    distance: 1500,
    records: { [createRace().run.category]: 1234 },
  };
  const file = {
    name: "progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProgress(profile)),
  };
  const input = data.locator("#data-import");
  await input.setInputFiles(file);
  const confirmation = page.getByRole("dialog", { name: "Reemplazar progreso", exact: true });
  await expect(confirmation).toContainText("0 → 1");
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  await expect(data.locator("#data-counts")).toContainText("Récords: 0");
  await input.setInputFiles(file);
  await confirmation.getByRole("button", { name: "Confirmar" }).click();
  await expect(data.locator("#data-status")).toHaveText("Progreso importado.");
  await data.getByRole("button", { name: "Cerrar datos" }).click();
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-storage", "saved");
  await expect(page.locator("#run-paint option[value='1']")).toBeEnabled();
  await page.getByRole("button", { name: "Datos locales", exact: true }).click();
  for (const text of [
    '{"app":"QRacer","formatVersion":1,"data":{"__proto__":{"polluted":true}}}',
    "<img src=x onerror=alert(1)>",
    "x".repeat(1024 * 1024 + 1),
  ]) {
    await expect(input).toBeEnabled();
    await input.setInputFiles({
      name: "untrusted.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    await expect(data.locator("#data-status")).toContainText("Archivo inválido");
    await expect(data.locator("#data-counts")).toContainText("Récords: 1");
    await expect(confirmation).not.toBeVisible();
  }
  const downloaded = page.waitForEvent("download");
  await data.getByRole("button", { name: "Exportar progreso", exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  if (!path) throw new Error("Missing export");
  expect(JSON.parse(await readFile(path, "utf8")).data).toEqual(profile);
  await data.getByText("Récords locales", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("local-data.png") });
  await data.getByRole("button", { name: "Borrar progreso y fantasmas" }).click();
  const deletion = page.getByRole("dialog", { name: "Borrar progreso y fantasmas", exact: true });
  await deletion.getByRole("button", { name: "Cancelar" }).click();
  await expect(data.locator("#data-counts")).toContainText("Récords: 1");
  await data.getByRole("button", { name: "Borrar progreso y fantasmas" }).click();
  await deletion.getByRole("button", { name: "Confirmar" }).click();
  await expect(data.locator("#data-status")).toHaveText("Progreso borrado.");
  await expect(data.locator("#data-counts")).toContainText("Récords: 0");
  await data.getByRole("button", { name: "Cerrar datos" }).click();
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Local data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Local data" })).toBeVisible();
  await page.getByRole("button", { name: "Delete progress and ghosts" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete progress and ghosts", exact: true }),
  ).toContainText("Records, objectives, runs");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
    localStorage.setItem("qracer.controller.settings.v1", JSON.stringify({ side: "left" }));
  });
  await page.getByRole("button", { name: "Reset PC preferences" }).click();
  const reset = page.waitForEvent("load");
  await page
    .getByRole("dialog", { name: "Reset PC preferences", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await reset;
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect(await page.evaluate(() => localStorage.getItem("qracer.presentation.v1"))).toBeNull();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("qracer.controller.settings.v1") ?? "{}"),
    ),
  ).toEqual({ side: "left" });
});

test("offers a recovery download for future data and refuses current-format replacement", async ({
  page,
}) => {
  await page.goto("/controller/");
  const future = { schemaVersion: 3, payload: "<img src=x onerror=alert(1)>" };
  await page.evaluate(
    (value) =>
      new Promise<void>((done) => {
        const req = indexedDB.open("qracer.progress", 3);
        req.onupgradeneeded = () => {
          for (const name of ["state", "ghosts", "quarantine"]) req.result.createObjectStore(name);
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(value, "profile");
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
    future,
  );
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container){const canvas=document.createElement("canvas");container.append(canvas);return {canvas,draw(){},stats:()=>({}),dispose(){canvas.remove()}};}`,
    }),
  );
  await page.goto("/play/");
  await expect(page.locator("#app")).toHaveAttribute("data-storage", "future");
  await page.getByRole("button", { name: "Datos locales", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Datos locales", exact: true });
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Exportar copia de recuperación" }).click();
  const path = await (await downloadEvent).path();
  if (!path) throw new Error("Missing recovery");
  expect(JSON.parse(await readFile(path, "utf8")).data).toEqual(future);
  await dialog.locator("#data-import").setInputFiles({
    name: "current.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProgress(freshData())),
  });
  await page
    .getByRole("dialog", { name: "Reemplazar progreso", exact: true })
    .getByRole("button", { name: "Confirmar" })
    .click();
  await expect(dialog.locator("#data-status")).toContainText("versión más reciente");
  await expect(page.locator("#app")).toHaveAttribute("data-storage", "future");
  await expect(page.locator("img[src=x]")).toHaveCount(0);
});
