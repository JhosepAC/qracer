import { expect, test } from "@playwright/test";
import { offlineServer } from "./offline-server.ts";

test.use({ serviceWorkers: "allow" });

test("caches only allowlisted static resources and reopens the real game offline", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const server = await offlineServer();
  try {
    await page.addInitScript(() => {
      localStorage.setItem("qracer.graphics.quality", "low");
      localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
    });
    await page.setViewportSize({ width: 480, height: 320 });
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
    await expect(page.locator("#start")).toBeEnabled();
    await page.locator("#start").click();
    await expect(page.locator("#app")).toHaveAttribute("data-mode", "playing");
    await page.keyboard.press("Escape");
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
