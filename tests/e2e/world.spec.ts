import { expect, test } from "@playwright/test";

test("loads all three original environments within the low scene budget", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem("qracer.graphics.quality", "low"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/play/");
  for (const biome of ["coast", "desert", "city"]) {
    await page.locator("#run-biome").selectOption(biome);
    await expect(page.getByRole("button", { name: "Salir a pista" })).toBeEnabled({
      timeout: 20000,
    });
    await expect(page.locator("#preview")).toHaveAttribute("data-biome", biome);
    const stats = JSON.parse(
      (await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}",
    );
    expect(stats.calls).toBeLessThanOrEqual(80);
    expect(stats.triangles).toBeLessThanOrEqual(150000);
    await page.screenshot({ path: info.outputPath(`${biome}.png`) });
  }
  expect(errors).toEqual([]);
});

test("keeps play disabled for a missing environment and recovers by choosing another", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("qracer.graphics.quality", "low"));
  await page.route("**/assets/world/desert.glb", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/play/");
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeEnabled({ timeout: 20000 });
  await page.locator("#run-biome").selectOption("desert");
  await expect(page.locator("#graphics-status")).toContainText("No se pudo cargar");
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeDisabled();
  await page.locator("#run-biome").selectOption("city");
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeEnabled({ timeout: 20000 });
  await expect(page.locator("#preview")).toHaveAttribute("data-biome", "city");
});
