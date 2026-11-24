import { openLane } from "../../packages/game-core/src/traffic.ts";
import { expect, test } from "@playwright/test";

const graphicsReady = { timeout: 20000 };

test("plays a coastal race with keyboard, pauses safely and restarts from zero", async ({
  page,
}, info) => {
  test.setTimeout(130000);
  await page.setViewportSize({ width: 480, height: 320 });
  // Exercise the game flow independently of software-GPU stalls in CI.
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    let time = 0;
    window.requestAnimationFrame = (callback) =>
      request(() => {
        time += 1000 / 12;
        callback(time);
      });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const transcoder = page.waitForResponse(/\/assets\/basis_transcoder-.+\.wasm$/);
  await page.addInitScript(() => localStorage.setItem("qracer.graphics.quality", "low"));
  await page.goto("/play/");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  expect((await transcoder).ok()).toBe(true);
  await expect(page.locator("#message")).toHaveText("3");
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => Number(await page.locator("#speed").textContent()), { timeout: 25000 })
    .toBeGreaterThan(115);
  await page.screenshot({ path: info.outputPath("f03-race.png") });
  const counters = JSON.parse(
    (await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}",
  );
  expect(counters.calls).toBeGreaterThan(0);
  expect(counters.calls).toBeLessThanOrEqual(80);
  expect(counters.triangles).toBeLessThanOrEqual(150000);
  expect(counters.height).toBeLessThanOrEqual(720);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
  const pausedScore = await page.locator("#score").textContent();
  await page.waitForTimeout(250);
  expect(await page.locator("#score").textContent()).toBe(pausedScore);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#app")).toHaveAttribute("data-mode", "paused");
  await page.keyboard.up("ArrowUp");
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(page.locator("#score")).toHaveText("0");
  await expect(page.locator("#integrity")).toHaveText("Integridad 3/3");

  // Select an occupied outer lane independently of the versioned generator.
  const occupiedSide = openLane(310) === 2 ? "ArrowLeft" : "ArrowRight";
  await page.keyboard.down(occupiedSide);
  await page.keyboard.down("ArrowUp");
  await expect(page.getByRole("heading", { name: "Fin de carrera" })).toBeVisible({
    timeout: 95000,
  });
  await expect(page.locator("#summary")).toContainText(/\d+ puntos/);
  await expect(page.locator("#result-speed")).toHaveText(/\d+ km\/h/);
  await expect(page.locator("#result-distance")).toHaveText(/\d+ m/);
  await page.keyboard.up(occupiedSide);
  await page.keyboard.up("ArrowUp");
  await page.screenshot({ path: info.outputPath("f03-results.png") });
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(page.locator("#message")).toHaveText("3");
  await expect(page.locator("#score")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("keeps race controls disabled when a model fails and recovers on reload", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("qracer.graphics.quality", "low"));
  await page.route("**/assets/coast/coupe.glb", (route) => route.abort());
  await page.goto("/play/");
  await expect(page.locator("#graphics-status")).toContainText("No se pudo cargar el circuito");
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Conocer el mando" })).toBeVisible();
  await page.unroute("**/assets/coast/coupe.glb");
  await page.reload();
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeEnabled(graphicsReady);
  await expect(page.locator("#preview canvas")).toHaveCount(1);
});

test("switches rendering profiles and keeps start disabled while models load", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 900 });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/coast/props.glb", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/play/");
  await expect(page.locator("#graphics-progress")).toHaveJSProperty("value", 3, graphicsReady);
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeDisabled();
  release();
  const view = page.locator("#preview");
  await expect(view).toHaveAttribute("data-quality", "balanced", graphicsReady);
  const select = page.getByLabel("Gráficos");
  for (const [profile, limit] of [
    ["high", 180],
    ["low", 80],
  ] as const) {
    await select.selectOption(profile);
    await expect(view).toHaveAttribute("data-quality", profile, graphicsReady);
    await expect(view.locator("canvas")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Salir a pista" })).toBeEnabled();
    const stats = JSON.parse((await view.getAttribute("data-render-stats")) ?? "{}");
    expect(stats.calls).toBeGreaterThan(0);
    expect(stats.calls).toBeLessThanOrEqual(limit);
    expect(stats.width).toBeLessThanOrEqual(profile === "low" ? 1280 : 1920);
    expect(stats.height).toBeLessThanOrEqual(profile === "low" ? 720 : 1080);
  }
  await page.reload();
  await expect(select).toHaveValue("low");
  await expect(view).toHaveAttribute("data-quality", "low", graphicsReady);
});
