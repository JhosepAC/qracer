import { expect, test } from "@playwright/test";

test("supports one-hand driving, brake priority and safe pauses on a small handset", async ({
  page,
  browser,
}) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container) { const canvas=document.createElement("canvas");container.append(canvas);return {canvas,draw(){},stats:()=>({}),dispose(){canvas.remove()}}; }`,
    }),
  );
  const phone = await browser.newPage({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: true,
  });
  let throttle = 0;
  let assist = false;
  await phone.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).RTCPeerConnection;
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
      value: async () => "granted",
    });
  });
  await phone.routeWebSocket("**/session/ws/**", (client) => {
    const server = client.connectToServer();
    client.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "INPUT") {
        throttle = frame.input.throttle;
        assist = frame.input.assist;
      }
      server.send(raw);
    });
  });
  try {
    await page.goto("/play/");
    await page.getByRole("button", { name: "Conectar móvil" }).click();
    await page.getByRole("button", { name: "Generar invitación" }).click();
    await expect(page.locator("#host-link")).toBeVisible();
    await phone.goto(await page.locator("#host-link").inputValue());
    await page.getByRole("button", { name: "Aprobar mando" }).click();
    await page.getByRole("button", { name: "Cerrar panel" }).click();
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    await phone.getByLabel("Modo de una mano (ayuda)").check();
    await phone.getByLabel("Reducir flashes").check();
    await expect.poll(() => assist).toBe(true);
    expect(throttle).toBe(0);
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    for (const size of [
      { width: 320, height: 568 },
      { width: 568, height: 320 },
    ]) {
      await phone.setViewportSize(size);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const controls = await phone.locator(".handset-input button").evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }),
      );
      expect(controls.every((r) => r.w >= 48 && r.h >= 48)).toBe(true);
    }
    await page.getByRole("button", { name: "Jugar con móvil" }).click();
    await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 15000 });
    await expect.poll(() => throttle).toBe(0.35);
    const brake = phone.getByRole("button", { name: "Freno", exact: true });
    await brake.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0 });
    await expect.poll(() => throttle).toBe(0);
    await brake.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "touch" });
    await expect.poll(() => throttle).toBe(0.35);
    await phone.getByRole("button", { name: "Activar inclinación" }).click();
    await phone.evaluate(async () => {
      for (let i = 0; i < 6; i++) {
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma: 0 }),
        );
        await new Promise((done) => setTimeout(done, 20));
      }
    });
    await expect(phone.locator("#tilt-status")).toContainText("Inclinación activa");
    await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
    await expect.poll(() => throttle).toBe(0);
    await phone.getByRole("button", { name: "Usar táctil" }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 15000 });
    await phone.getByRole("button", { name: "Pausa", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
    await expect.poll(() => throttle).toBe(0);
    const saved = await phone.evaluate(() =>
      JSON.parse(localStorage.getItem("qracer.controller.settings.v1") ?? "{}"),
    );
    expect(saved.oneHand).toBe(true);
    expect(saved.reducedFlashes).toBe(true);
  } finally {
    await phone.close();
  }
});
