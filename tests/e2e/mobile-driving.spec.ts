import { readFile } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";

test("drives with two fingers, falls back from denied tilt and pauses on stale input", async ({
  page,
}, info) => {
  test.setTimeout(85000);
  await page.setViewportSize({ width: 480, height: 320 });
  // Keep transport and simulation on real clocks. The separate graphics tests and
  // the packaged LAN smoke exercise WebGL. Software GPU stalls should not drive this test.
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
      export async function createRaceView(container) {
        const canvas = document.createElement("canvas");
        container.append(canvas);
        return { canvas, draw(_previous, current) {
          container.dataset.lateral = String(current.driver.d);
        }, stats: () => ({}), dispose: () => canvas.remove() };
      }
    `,
    }),
  );
  const handset = await chromium.launch();
  const phone = await handset.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  let dropInput = false;
  let twoFingers = false;
  let tiltSteering = false;
  let pauseSent = false;
  await phone.routeWebSocket("**/session/ws/**", (client) => {
    const server = client.connectToServer();
    client.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "INPUT" && frame.input.throttle === 1 && frame.input.steer > 0.25)
        twoFingers = true;
      if (frame.type === "INPUT" && frame.input.throttle === 0 && frame.input.steer > 0.2)
        tiltSteering = true;
      if (!dropInput && frame.type === "DRIVE_PAUSE") pauseSent = true;
      if (dropInput && (frame.type === "INPUT" || frame.type === "DRIVE_PAUSE")) return;
      server.send(raw);
    });
  });
  await phone.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).RTCPeerConnection;
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      value: async () => document.body.dataset.tiltPermission ?? "denied",
    });
    Object.defineProperty(window.navigator, "vibrate", {
      value: (duration: number) => {
        document.body.dataset.haptic = String(duration);
        return true;
      },
    });
  });

  const file = (name: string) => info.outputPath(name);
  const tiltRight = () =>
    phone.evaluate(async () => {
      function orientation(gamma: number) {
        window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma }));
      }
      for (let i = 0; i < 5; i++) {
        orientation(0);
        await new Promise((done) => setTimeout(done, 16));
      }
      for (let i = 0; i < 12; i++) {
        await new Promise((done) => setTimeout(done, 24));
        orientation(22);
      }
    });
  try {
    await page.goto("/play/");
    await page.getByRole("button", { name: "Conectar móvil" }).click();
    await page.getByRole("button", { name: "Generar invitación" }).click();
    await expect(page.locator("#host-link")).toBeVisible();
    await phone.goto(await page.locator("#host-link").inputValue());
    await page.getByRole("button", { name: "Aprobar mando" }).click();
    await page.getByRole("button", { name: "Cerrar panel" }).click();
    await expect(phone.locator("#drive-shell")).toBeVisible();
    await expect(
      phone.getByRole("group", { name: "Modo de dirección" }).getByRole("button").first(),
    ).toHaveText("Activar inclinación");
    await phone.getByRole("button", { name: "Activar inclinación" }).click();
    await expect(phone.locator("#tilt-status")).toContainText("Permiso denegado");
    await phone.evaluate(() => {
      document.body.dataset.tiltPermission = "granted";
    });
    await phone.getByRole("button", { name: "Activar inclinación" }).click();
    await tiltRight();
    await expect.poll(() => tiltSteering).toBe(true);
    await expect(phone.locator("#tilt-status")).toContainText("Inclinación activa");
    await expect(phone.locator("#tilt-status")).toContainText("dejó de responder");
    await phone.getByRole("button", { name: "Usar táctil" }).click();

    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    await phone.getByLabel("Lado de los pedales").selectOption("left");
    await phone.getByLabel("Vibración", { exact: true }).check();
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    await expect(phone.locator("#drive-shell")).toHaveAttribute("data-side", "left");
    await phone.setViewportSize({ width: 844, height: 390 });
    const clipped = await phone.locator(".handset-input button").evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const { width, height, right, bottom, top, left } = button.getBoundingClientRect();
        return width < 48 ||
          height < 48 ||
          left < 0 ||
          right > innerWidth ||
          top < 0 ||
          bottom > innerHeight
          ? [
              {
                control: button.getAttribute("data-drive"),
                width,
                height,
                right,
                bottom,
                top,
                left,
              },
            ]
          : [];
      }),
    );
    expect(clipped).toEqual([]);
    await phone.setViewportSize({ width: 390, height: 844 });

    const start = page.getByRole("button", { name: "Jugar con móvil" });
    await expect(start).toBeEnabled({ timeout: 20000 });
    await start.click();
    await expect(page.locator("#app")).toHaveAttribute("data-control", "mobile");
    await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 20000 });
    await phone.getByRole("button", { name: "Activar inclinación" }).click();
    await tiltRight();
    await expect
      .poll(async () => Number(await page.locator("#preview").getAttribute("data-lateral")))
      .toBeGreaterThan(0.2);
    await phone.getByRole("button", { name: "Usar táctil" }).click();

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
    // A burst of wheel events must reuse one layout measurement, then release safely.
    await phone.evaluate(() => {
      const wheel = document.querySelector("[data-drive=wheel]");
      if (!wheel) throw new Error("Missing wheel");
      wheel.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 9, button: 0, clientX: 180 }),
      );
      for (let i = 0; i < 100; i++)
        wheel.dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, clientX: 100 + i }));
      wheel.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 9 }));
    });
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
    const mobileDownload = phone.waitForEvent("download");
    await phone.locator("#drive-diagnostic").click();
    const mobilePath = await (await mobileDownload).path();
    if (!mobilePath) throw new Error("Missing mobile download");
    const diagnostic = JSON.parse(await readFile(mobilePath, "utf8"));
    expect(diagnostic.performance.wheelLayoutReads).toBe(1);
    expect(diagnostic.performance.eventToSnapshotMs.samples).toBeGreaterThan(0);
    expect(diagnostic.rttMsHistogram.samples).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toMatch(/token|sdp|candidate|gamma|beta/);
    await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
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
    pauseSent = false;
    await phone.getByRole("button", { name: "Pausa", exact: true }).click();
    await expect.poll(() => pauseSent).toBe(true);
    // An already-expired watchdog may pause just before the explicit command arrives.
    await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
    await page.getByRole("button", { name: "Usar teclado" }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-control", "keyboard");
    await page.locator("#return-menu").click();
    await page.getByRole("button", { name: "Datos locales", exact: true }).click();
    const pcDownload = page.waitForEvent("download");
    await page.locator("#data-performance").click();
    const pcPath = await (await pcDownload).path();
    if (!pcPath) throw new Error("Missing PC download");
    const pc = JSON.parse(await readFile(pcPath, "utf8"));
    expect(pc.pipeline.receiptToSimulationMs.samples).toBeGreaterThan(0);
    expect(pc.pipeline.receiptToSubmissionMs.samples).toBeGreaterThan(0);
    expect(pc.pipeline.clock).toBe("PC performance.now");
    expect(pc.pipeline.meaning).toContain("not input-to-display");
    expect(pc.rttMs.samples).toBeGreaterThan(0);
    expect(JSON.stringify(pc)).not.toMatch(/token|sdp|candidate|gamma|beta/);
  } finally {
    await handset.close();
  }
});
