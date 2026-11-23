import { expect, test } from "@playwright/test";

test("plays a coastal race with keyboard, pauses safely and restarts from zero", async ({
  page,
}, info) => {
  test.setTimeout(65000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/play/");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await expect(page.locator("#message")).toHaveText("3");
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => Number(await page.locator("#speed").textContent()))
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

  // Seed 310 includes cars on the right. Hold that lane to finish by impacts.
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowUp");
  await expect(page.getByRole("heading", { name: "Fin de carrera" })).toBeVisible({
    timeout: 45000,
  });
  await expect(page.locator("#summary")).toContainText(/\d+ puntos/);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowUp");
  await page.screenshot({ path: info.outputPath("f03-results.png") });
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(page.locator("#message")).toHaveText("3");
  await expect(page.locator("#score")).toHaveText("0");
  expect(errors).toEqual([]);
});
