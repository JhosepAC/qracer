import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("plays practice and both timed modes with paused clocks and repeatable categories", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container) { const canvas = document.createElement('canvas'); container.append(canvas); return { canvas, draw(){}, stats:()=>({}), dispose:()=>canvas.remove() }; }`,
    }),
  );
  await page.addInitScript(() => {
    let time = 0;
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => {
        time += 1000 / 12;
        callback(time);
      }, 1);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto("/play/");
  await page.locator("#run-mode").selectOption("practice");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await expect(page.locator("#run-hud")).toContainText("Práctica");
  await page.getByRole("button", { name: "Terminar práctica" }).click();
  await expect(page.locator("#run-result")).toContainText("Sin récord competitivo");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar resumen de carrera" }).click();
  const download = await downloadEvent;
  const path = await download.path();
  if (!path) throw new Error("Missing run summary");
  const summary = JSON.parse(await readFile(path, "utf8"));
  expect(summary.mode).toBe("practice");
  expect(summary.rulesVersion).toBe(2);
  expect(summary.generatorVersion).toBe(2);
  expect(summary.integrity).toBe(3);
  expect(summary.impacts).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(summary)).not.toMatch(/token|sdp|candidate|orientation/i);
  await page.getByRole("button", { name: "Elegir otro recorrido" }).click();
  for (const mode of ["time-trial", "daily"]) {
    await page.locator("#run-mode").selectOption(mode);
    if (mode === "daily") await expect(page.locator("#run-seed")).toBeDisabled();
    else await page.locator("#run-seed").fill("44");
    await page.getByRole("button", { name: "Salir a pista" }).click();
    const category = await page.locator("#app").getAttribute("data-run-category");
    await page.getByRole("button", { name: "Pausa", exact: false }).click();
    const frozen = await page.locator("#score").textContent();
    await page.waitForTimeout(150);
    expect(await page.locator("#score").textContent()).toBe(frozen);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fin de carrera" })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator("#run-result")).toContainText("Récord de esta sesión");
    await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-run-category", category ?? "");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Elegir otro recorrido" }).click();
  }
});
