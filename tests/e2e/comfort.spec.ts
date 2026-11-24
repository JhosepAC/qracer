import { expect, test } from "@playwright/test";

test("honors reduced motion and supports conflict-free remapping and assisted keyboard play", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("qracer.graphics.quality", "low");
    localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
  });
  await page.goto("/play/");
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeEnabled({ timeout: 20000 });
  await expect(page.locator("#preview")).toHaveAttribute("data-stable-camera", "true");
  await expect(page.locator("#preview")).toHaveAttribute("data-reduced-flashes", "true");
  await page.getByRole("button", { name: "Sonido y comodidad" }).click();
  await page.getByLabel("Reducir movimiento", { exact: true }).isChecked();
  await page.getByLabel("Conducción asistida con teclado").check();
  await page.getByText("Teclado", { exact: true }).click();
  const left = page.getByLabel("Girar a la izquierda", { exact: true });
  await left.focus();
  await left.press("j");
  await expect(left).toHaveValue("J");
  const right = page.getByLabel("Girar a la derecha", { exact: true });
  await right.focus();
  await right.press("j");
  await expect(page.locator("#binding-status")).toHaveText("Esa tecla ya está asignada.");
  await right.press("l");
  const throttle = page.getByRole("textbox", { name: "Acelerar", exact: true });
  await throttle.focus();
  await throttle.press("i");
  await page.keyboard.press("Tab");
  await expect(throttle).not.toBeFocused();
  await page.getByRole("button", { name: "Cerrar ajustes" }).click();
  await expect(page.locator("#presentation-open")).toBeFocused();
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await page.keyboard.down("i");
  await expect
    .poll(async () => Number(await page.locator("#speed").textContent()), { timeout: 10000 })
    .toBeGreaterThan(100);
  await page.keyboard.up("i");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("qracer.presentation.v1") ?? "{}"),
  );
  expect(saved.bindings.left).toBe("KeyJ");
  expect(saved.assisted).toBe(true);
});
