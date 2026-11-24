import { chromium, expect, test } from "@playwright/test";

for (const scenario of ["direct", "ice-failed", "unsupported"] as const) {
  test(`recovers safely with ${scenario} transport`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.route("**/assets/race-view-*.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export async function createRaceView(container) {
        const canvas = document.createElement('canvas'); container.append(canvas);
        return { canvas, draw() {}, stats: () => ({}), dispose() {} };
      }`,
      }),
    );
    const browser = await chromium.launch();
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    for (const tab of [page, phone])
      await tab.addInitScript((mode) => {
        if (mode === "unsupported") {
          delete (window as unknown as Record<string, unknown>).RTCPeerConnection;
          return;
        }
        const Original = window.RTCPeerConnection;
        const peers: RTCPeerConnection[] = [];
        Object.assign(window, { qracerTestPeers: peers });
        window.RTCPeerConnection = new Proxy(Original, {
          construct(target, args) {
            const connection = new target(
              mode === "ice-failed" ? { iceServers: [], iceTransportPolicy: "relay" } : args[0],
            );
            peers.push(connection);
            return connection;
          },
        });
      }, scenario);
    const route = (tab: typeof page) => tab.locator("html").getAttribute("data-transport");
    const metrics = (tab: typeof page) =>
      tab
        .locator("html")
        .evaluate((el) => JSON.parse((el as HTMLElement).dataset.transportMetrics ?? "{}"));
    let wssInputs = 0;
    await phone.routeWebSocket("**/session/ws/**", (client) => {
      const server = client.connectToServer();
      client.onMessage((raw) => {
        if (JSON.parse(String(raw)).type === "INPUT") wssInputs++;
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
      if (scenario === "direct") {
        await expect.poll(() => route(page)).toBe("rtc");
        await expect.poll(() => route(phone)).toBe("rtc");
        await expect(phone.locator("#app")).toHaveAttribute("data-epoch", "2");
        const before = wssInputs;
        await expect.poll(async () => (await metrics(phone)).rtcDrive).toBeGreaterThan(15);
        expect(wssInputs - before).toBeLessThanOrEqual(1);
      } else {
        await page.waitForTimeout(5500);
        expect(await route(page)).toBe("wss");
        expect(wssInputs).toBeGreaterThan(60);
      }
      const start = page.getByRole("button", { name: "Jugar con móvil" });
      await expect(start).toBeEnabled({ timeout: 15000 });
      await start.click();
      await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 15000 });
      const accel = phone.getByRole("button", { name: "Acelerar" });
      await accel.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", button: 0 });
      await expect
        .poll(async () => Number(await page.locator("#speed").textContent()))
        .toBeGreaterThan(100);
      if (scenario === "direct") {
        await phone.evaluate(() => {
          const peers = (window as unknown as { qracerTestPeers: RTCPeerConnection[] })
            .qracerTestPeers;
          for (const pc of peers) pc.close();
        });
        await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
        await expect.poll(() => route(page)).toBe("wss");
        await expect(phone.locator("#app")).toHaveAttribute("data-epoch", "3");
        await expect(accel).not.toHaveAttribute("data-held", "");
        await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled({
          timeout: 15000,
        });
        await page.waitForTimeout(500);
        await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
        await page.getByRole("button", { name: "Continuar" }).click();
        await expect(phone.locator("#drive-state")).toContainText("Cuenta atrás");
        await expect(phone.locator("#drive-state")).toContainText("En carrera", { timeout: 15000 });
      }
      await info.attach("transport-metrics", {
        body: JSON.stringify(
          { scenario, host: await metrics(page), phone: await metrics(phone), wssInputs },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      await browser.close();
    }
  });
}
