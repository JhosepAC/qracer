import { expect, test } from "@playwright/test";

test("probe authenticates two browsers, clears invitation and releases cancelled input", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/probe/");
  await page.getByRole("button", { name: "Crear enlace" }).click();
  const invite = page.getByRole("link", { name: "Abrir mando de prueba" });
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  expect(href).toContain("#relay=");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(href ?? "");
  await expect(mobile.getByRole("status")).toHaveText("Conectado · WSS");
  expect(new URL(mobile.url()).hash).toBe("");
  const gas = mobile.getByRole("button", { name: "ACELERAR" });
  const right = mobile.getByRole("button", { name: "Girar a la derecha" });
  // Real pointer capture requires a trusted down; cancellation tests dispatch the corresponding browser event.
  const point = await gas.boundingBox();
  if (!point) throw new Error("Missing gas control");
  await mobile.mouse.move(point.x + 30, point.y + 30);
  await mobile.mouse.down();
  await expect(page.locator("#meter")).toContainText("GAS 1.0");
  await gas.dispatchEvent("pointercancel", { pointerId: 1 });
  await mobile.mouse.up();
  await expect(page.locator("#meter")).toContainText("GAS 0.0");
  await right.focus();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ path: testInfo.outputPath("probe-controller.png"), fullPage: true });
  await expect(page.locator("#metrics")).not.toContainText("RTT —", { timeout: 4000 });
  await expect(page.locator("#rtc-status")).toContainText(/directo|WSS continúa|no disponible/, {
    timeout: 7000,
  });
  await testInfo.attach("rtc-browser-result", {
    body: (await page.locator("#rtc-status").textContent()) ?? "",
    contentType: "text/plain",
  });
  await mobileContext.close();
  await expect(page.locator("#meter")).toHaveText("PAUSA SEGURA");
  // Host screenshot excludes the consumed invitation/QR from its evidence.
  await page.locator("#invite").evaluate((node) => {
    node.removeAttribute("href");
  });
  await page.locator("#qr").evaluate((node) => {
    node.replaceChildren();
  });
  await page.screenshot({ path: testInfo.outputPath("probe-host.png"), fullPage: true });
});

test("denied sensors and unavailable RTC preserve tactile control", async ({ page, browser }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "RTCPeerConnection", {
      value: class {
        constructor() {
          throw new Error("Unsupported");
        }
      },
    });
  });
  await page.goto("/probe/");
  await page.getByRole("button", { name: "Crear enlace" }).click();
  const invite = page.getByRole("link", { name: "Abrir mando de prueba" });
  await expect(invite).toBeVisible();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
      value: async () => "denied",
    });
  });
  const mobile = await context.newPage();
  await mobile.goto((await invite.getAttribute("href")) ?? "");
  await mobile.getByText("Pruebas opcionales").click();
  await mobile.getByRole("button", { name: "Activar inclinación" }).click();
  await expect(mobile.locator("#sensor-status")).toContainText("denegado");
  await expect(mobile.getByRole("button", { name: "ACELERAR" })).toBeEnabled();
  await expect(page.locator("#rtc-status")).toContainText("WSS continúa");
  await expect(page.locator("#metrics")).not.toContainText("RTT —", { timeout: 4000 });
  await context.close();
});

test("stops input snapshots when the PC leaves so the empty room can hibernate", async ({
  page,
  browser,
}) => {
  await page.goto("/probe/");
  await page.getByRole("button", { name: "Crear enlace" }).click();
  const invite = page.getByRole("link", { name: "Abrir mando de prueba" });
  await expect(invite).toBeVisible();
  const url = await invite.getAttribute("href");
  const context = await browser.newContext();
  const mobile = await context.newPage();
  let inputs = 0;
  mobile.on("websocket", (socket) =>
    socket.on("framesent", (event) => {
      if (JSON.parse(String(event.payload)).type === "INPUT") inputs++;
    }),
  );
  await mobile.goto(url ?? "");
  await expect(mobile.locator("#status")).toHaveText("Conectado · WSS");
  await expect.poll(() => inputs).toBeGreaterThan(2);
  await page.close();
  await expect(mobile.locator("#status")).toHaveText("Esperando a la PC");
  const stopped = inputs;
  await mobile.waitForTimeout(350);
  expect(inputs).toBe(stopped);
  await context.close();
});
