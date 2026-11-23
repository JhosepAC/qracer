import { chromium, expect, test } from "@playwright/test";

test("drives with two fingers, falls back from denied tilt and pauses on stale input", async ({
  page,
}, info) => {
  test.setTimeout(85000);
  await page.setViewportSize({ width: 480, height: 320 });
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    let time = 0;
    window.requestAnimationFrame = (callback) =>
      request(() => {
        time += 1000 / 20;
        callback(time);
      });
  });
  const handset = await chromium.launch();
  const phone = await handset.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  let dropInput = false;
  let twoFingers = false;
  await phone.routeWebSocket("**/session/ws/**", (client) => {
    const server = client.connectToServer();
    client.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "INPUT" && frame.input.throttle === 1 && frame.input.steer > 0.25)
        twoFingers = true;
      if (dropInput && (frame.type === "INPUT" || frame.type === "DRIVE_PAUSE")) return;
      server.send(raw);
    });
  });
  await phone.addInitScript(() => {
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      value: async () => "denied",
    });
    Object.defineProperty(window.navigator, "vibrate", {
      value: (duration: number) => {
        document.body.dataset.haptic = String(duration);
        return true;
      },
    });
  });

  const file = (name: string) => info.outputPath(name);
  try {
    await page.goto("/play/");
    await page.getByRole("button", { name: "Conectar móvil" }).click();
    await page.getByRole("button", { name: "Generar invitación" }).click();
    await expect(page.locator("#host-link")).toBeVisible();
    await phone.goto(await page.locator("#host-link").inputValue());
    await page.getByRole("button", { name: "Aprobar mando" }).click();
    await page.getByRole("button", { name: "Cerrar panel" }).click();
    await expect(phone.locator("#drive-shell")).toBeVisible();
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    await phone.getByRole("button", { name: "Activar inclinación" }).click();
    await expect(phone.locator("#tilt-status")).toContainText("Permiso denegado");
    await phone.getByLabel("Lado de los pedales").selectOption("left");
    await phone.getByLabel("Vibración", { exact: true }).check();
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    await expect(phone.locator("#drive-shell")).toHaveAttribute("data-side", "left");

    const start = page.getByRole("button", { name: "Jugar con móvil" });
    await expect(start).toBeEnabled({ timeout: 20000 });
    await start.click();
    await expect(page.locator("#app")).toHaveAttribute("data-control", "mobile");
    await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 20000 });

    const accel = phone.getByRole("button", { name: "Acelerar" });
    const right = phone.getByRole("button", { name: "Girar a la derecha" });
    const boost = phone.locator("[data-drive=boost]");
    await accel.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0 });
    await right.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", button: 0 });
    await expect.poll(() => twoFingers).toBe(true);
    await right.dispatchEvent("pointercancel", { pointerId: 2, pointerType: "touch" });
    await expect(right).not.toHaveAttribute("data-held", "");
    await boost.dispatchEvent("pointerdown", { pointerId: 3, pointerType: "touch", button: 0 });
    await expect(phone.locator("body")).toHaveAttribute("data-haptic", "28", { timeout: 10000 });
    await boost.dispatchEvent("pointercancel", { pointerId: 3, pointerType: "touch" });
    await expect
      .poll(async () => Number(await page.locator("#speed").textContent()), { timeout: 15000 })
      .toBeGreaterThan(100);
    await phone.screenshot({ path: file("mobile-drive.png") });

    dropInput = true;
    await phone.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
    await expect(page.locator("#summary")).toContainText("Se perdió la entrada");
    await expect(accel).not.toHaveAttribute("data-held", "");
    const frozen = await page.locator("#score").textContent();
    await page.waitForTimeout(300);
    expect(await page.locator("#score").textContent()).toBe(frozen);
    await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();

    dropInput = false;
    await phone.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const resume = page.getByRole("button", { name: "Continuar" });
    await expect(resume).toBeEnabled({ timeout: 10000 });
    await resume.click();
    await expect(phone.locator("#drive-state")).toContainText("Cuenta atrás");
    await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 20000 });
    await phone.getByRole("button", { name: "Pausa", exact: true }).click();
    await expect(page.locator("#summary")).toContainText("El móvil solicitó una pausa");
    await page.getByRole("button", { name: "Usar teclado" }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-control", "keyboard");
  } finally {
    await handset.close();
  }
});
