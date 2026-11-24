import { expect, test } from "@playwright/test";
import { offlineServer, prepareGraphics } from "./offline-server.ts";

test.use({ serviceWorkers: "allow" });
test.setTimeout(60000);
test.beforeEach(async ({ page }) => {
  await prepareGraphics(page);
});

test("prepares and reopens offline play through the production local relay", async ({
  page,
  context,
}) => {
  await page.goto("/play/");
  await expect(page.locator("#offline-status")).toContainText("disponible sin conexión", {
    timeout: 30000,
  });
  expect(
    await page.evaluate(async () => (await fetch("/LICENSE.txt")).headers.get("content-type")),
  ).toContain("text/plain");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
  await context.setOffline(false);
});

test("downloads optional worlds and clears only game downloads after confirmation", async ({
  page,
  context,
}) => {
  const server = await offlineServer();
  try {
    await page.goto(`${server.origin}/play/`);
    await page.locator("#offline-menu summary").click();
    await expect(page.locator("#offline-status")).toContainText("disponible sin conexión", {
      timeout: 20000,
    });
    await page.locator("#offline-download").click();
    await expect(page.locator("#offline-worlds")).toHaveText(
      "Desierto descargado · Ciudad descargada",
    );
    await page.evaluate(async () => {
      await (await caches.open("another-app")).put("/unrelated", new Response("keep"));
      localStorage.setItem("qracer.controller.settings.v1", "keep");
    });
    await page.getByRole("button", { name: "Datos locales", exact: true }).click();
    await page.locator("#data-import").setInputFiles({
      name: "progress.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          app: "QRacer",
          formatVersion: 1,
          data: {
            schemaVersion: 2,
            progress: {
              schemaVersion: 1,
              distance: 1234,
              overtakes: 0,
              nearMisses: 0,
              recent: [],
              records: {},
            },
            history: [],
          },
        }),
      ),
    });
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.locator("#data-counts")).toContainText("1234 m");
    await page.locator("#data-cache").click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(
      await page.evaluate(async () => (await caches.keys()).some((name) => name.endsWith("-core"))),
    ).toBe(true);
    await page.locator("#data-cache").click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.locator("#data-status")).toContainText("Descargas borradas");
    const storage = await page.evaluate(async () => ({
      names: await caches.keys(),
      preferences: localStorage.getItem("qracer.controller.settings.v1"),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
    }));
    expect(
      storage.names.filter((name) => name.endsWith("-core") || name.endsWith("-extra")),
    ).toEqual([]);
    expect(storage.names).toContain("another-app");
    expect(storage.preferences).toBe("keep");
    expect(storage.registrations).toBe(0);
    await page.reload();
    await expect(page.locator("#offline-status")).toContainText("Descargas desactivadas");
    await page.getByRole("button", { name: "Datos locales", exact: true }).click();
    await expect(page.locator("#data-counts")).toContainText("1234 m");
    await page.getByRole("button", { name: "Cerrar datos", exact: true }).click();
    await page.locator("#offline-menu summary").click();
    await page.locator("#offline-prepare").click();
    await expect(page.locator("#offline-status")).toContainText("disponible sin conexión", {
      timeout: 20000,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});

test("waits for all PC tabs to reach the menu before activating and reloading", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const server = await offlineServer();
  const second = await context.newPage();
  await prepareGraphics(second);
  try {
    await context.addInitScript(() => {
      sessionStorage.setItem(
        "f10-loads",
        String(Number(sessionStorage.getItem("f10-loads") ?? 0) + 1),
      );
      localStorage.setItem("qracer.graphics.quality", "low");
      localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
    });
    await page.goto(`${server.origin}/play/`);
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 })
      .toBe(true);
    await second.goto(`${server.origin}/play/`);
    await page.locator("#start").click();
    const initial = await page.evaluate(() => sessionStorage.getItem("f10-loads"));
    server.revise();
    await second.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect
      .poll(() =>
        second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    await second.locator("#offline-menu summary").click();
    await second.locator("#offline-update").click();
    await expect(second.locator("#offline-status")).toContainText("otras pestañas");
    expect(await page.evaluate(() => sessionStorage.getItem("f10-loads"))).toBe(initial);
    expect(
      await second.evaluate(
        async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    if ((await page.locator("#app").getAttribute("data-mode")) === "playing")
      await page.keyboard.press("Escape");
    await page.locator("#return-menu").click();
    await expect(page.locator("#preview")).toHaveAttribute("data-graphics", "ready");
    const navigations = [
      page.waitForEvent("domcontentloaded"),
      second.waitForEvent("domcontentloaded"),
    ];
    await second.locator("#offline-update").click();
    await Promise.all(navigations);
    expect(await page.evaluate(() => sessionStorage.getItem("f10-loads"))).not.toBe(initial);
    expect(await second.evaluate(() => Number(sessionStorage.getItem("f10-loads")))).toBe(2);
    expect(
      await second.evaluate(
        async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(false);
    expect(
      (await second.evaluate(() => caches.keys())).filter((name) => name.endsWith("-core")).length,
    ).toBeLessThanOrEqual(2);
  } finally {
    await second.close();
    await server.close();
  }
});

test("keeps keyboard play working when service-worker registration is denied", async ({ page }) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container){const canvas=document.createElement('canvas');container.append(canvas);return {canvas,draw(){},stats:()=>({}),dispose(){canvas.remove()}}}`,
    }),
  );
  await page.addInitScript(() => {
    navigator.serviceWorker.register = () =>
      Promise.reject(new DOMException("denied", "SecurityError"));
  });
  await page.goto("/play/");
  await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
  await expect(page.locator("#offline-status")).toContainText("Puedes jugar con red");
  await page.locator("#start").click();
  await expect(page.locator("#app")).toHaveAttribute("data-mode", "playing");
});

test("evicts optional downloads on cache quota failure and preserves the essential course", async ({
  page,
  context,
}) => {
  const server = await offlineServer();
  try {
    await page.goto(`${server.origin}/play/`);
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 })
      .toBe(true);
    const active = context
      .serviceWorkers()
      .find((worker) => worker.url() === `${server.origin}/sw.js`);
    if (!active) throw new Error("Missing real service worker");
    await active.evaluate(() => {
      const original = Cache.prototype.put;
      let failed = false;
      Cache.prototype.put = function (request, response) {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (url.includes("/coast/props.glb") && !failed) {
          failed = true;
          return Promise.reject(new DOMException("full", "QuotaExceededError"));
        }
        return original.call(this, request, response);
      };
    });
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (name.endsWith("-core"))
          await (await caches.open(name)).delete("/assets/coast/props.glb");
        if (name.endsWith("-extra")) await caches.delete(name);
      }
    });
    expect(await page.evaluate(async () => (await fetch("/assets/coast/props.glb")).status)).toBe(
      200,
    );
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
    await expect(page.locator("#offline-status")).toContainText("disponible sin conexión", {
      timeout: 20000,
    });
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});
