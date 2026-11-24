import { expect, test } from "@playwright/test";

test("downloads initial models concurrently and abandons a cancelled scene without duplicating canvases", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 480, height: 320 });
  await page.addInitScript(() => localStorage.setItem("qracer.graphics.quality", "low"));
  const requests = new Set<string>();
  page.on("request", (request) => {
    const match = request.url().match(/\/assets\/coast\/(coupe|coast|props)\.glb$/);
    if (match?.[1]) requests.add(match[1]);
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/assets/coast/coupe.glb", async (route) => {
    if (first) {
      first = false;
      await held;
    }
    try {
      await route.continue();
    } catch (error) {
      if (!route.request().failure()) throw error;
    }
  });
  await page.goto("/play/");
  await expect.poll(() => requests.size).toBe(3);
  await page.locator("#run-biome").selectOption("desert");
  release();
  await expect(page.locator("#preview")).toHaveAttribute("data-graphics", "ready", {
    timeout: 30000,
  });
  await expect(page.locator("#preview canvas")).toHaveCount(1);
  await expect(page.locator("#start")).toBeEnabled();
  const stats = JSON.parse(
    (await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}",
  );
  expect(stats.geometryBytesEstimate).toBeGreaterThan(0);
  expect(stats.textureBytesEstimate).toBeLessThanOrEqual(128 * 1024 * 1024);
  expect(stats.localCoordinateMax).toBeLessThan(1024);
  expect(stats.startupMs).toBeGreaterThan(0);
  expect(stats.shaderWarmupMs).toBeGreaterThanOrEqual(0);
});
