import { expect, test } from "@playwright/test";
import { offlineServer, prepareGraphics } from "./offline-server.ts";

test.use({ serviceWorkers: "allow" });

test("caches only allowlisted static resources and reopens the real game offline", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await prepareGraphics(page);
  const server = await offlineServer();
  try {
    await page.goto(`${server.origin}/play/`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.evaluate(async () => {
      await fetch("/session", { method: "POST" });
      await fetch("/health");
      await fetch("/assets/coast/coupe.glb?token=private");
      await fetch("/assets/coast/coupe.glb", { headers: { Authorization: "test-secret" } });
      for (const name of await caches.keys())
        if (name.endsWith("-extra")) await caches.delete(name);
    });
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      return urls;
    });
    expect(cached.some((url) => url.endsWith("/play/"))).toBe(true);
    expect(cached.join(" ")).not.toMatch(/session|health|token=|controller|probe/);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
    await page.locator("#start").click();
    await expect(page.locator("#app")).toHaveAttribute("data-mode", "playing");
    await page.keyboard.press("Escape");
    await page.locator("#return-menu").click();
    await page.locator("#run-biome").selectOption("desert");
    await expect(page.locator("#graphics-status")).toContainText("Este entorno no está descargado");
    expect(await page.evaluate(async () => (await fetch("/assets/world/desert.glb")).status)).toBe(
      503,
    );
    expect(
      await page.evaluate(async () =>
        fetch("/health").then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false);
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});

test("refuses mismatched downloads while preserving the installed shell", async ({ page }) => {
  const server = await offlineServer();
  try {
    await page.goto(`${server.origin}/play/`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.evaluate(async () => {
      for (const name of await caches.keys())
        if (name.endsWith("-extra")) await caches.delete(name);
    });
    server.files.set("/assets/world/desert.glb", Buffer.from("different build"));
    expect(await page.evaluate(async () => (await fetch("/assets/world/desert.glb")).status)).toBe(
      503,
    );
    expect(await page.evaluate(async () => (await fetch("/play/")).status)).toBe(200);
  } finally {
    await server.close();
  }
});

test("keeps one offline update listener across graphics rebuilds", async ({ page }) => {
  test.setTimeout(60000);
  await prepareGraphics(page);
  await page.addInitScript(() => {
    const handlers = new Set<EventListenerOrEventListenerObject>();
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, handler, options) {
      if (this instanceof ServiceWorkerRegistration && type === "updatefound" && handler) {
        handlers.add(handler);
        document.documentElement.dataset.updateListeners = String(handlers.size);
      }
      return add.call(this, type, handler, options);
    };
  });
  const server = await offlineServer();
  try {
    await page.goto(`${server.origin}/play/`);
    await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    for (const quality of ["balanced", "low", "balanced", "low"]) {
      await page.locator("#graphics-quality").selectOption(quality);
      await expect(page.locator("#start")).toBeEnabled({ timeout: 20000 });
      await expect(page.locator("html")).toHaveAttribute("data-update-listeners", "1");
    }
  } finally {
    await server.close();
  }
});
