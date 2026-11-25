import { expect, test } from "@playwright/test";

test("loads compressed Blender textures in a named worker and rejects foreign bootstrap code", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 480, height: 320 });
  await page.addInitScript(() => localStorage.setItem("qracer.graphics.quality", "low"));
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(new URL(worker.url()).pathname));
  await page.goto("/play/");
  await expect(page.locator("#start")).toBeEnabled({ timeout: 25000 });
  expect(workers.length).toBeGreaterThan(0);
  expect(workers.every((path) => path === "/decoder-worker.js")).toBe(true);
  const before = workers.length;
  let remote = false;
  await page.route("https://blocked.invalid/**", (route) => {
    remote = true;
    return route.fulfill({ body: "postMessage('bad')" });
  });
  const rejected = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const worker = new Worker("/decoder-worker.js");
        worker.onerror = (event) => {
          event.preventDefault();
          worker.terminate();
          resolve(true);
        };
        worker.onmessage = () => {
          worker.terminate();
          resolve(false);
        };
        worker.postMessage({
          type: "load-decoder",
          source: "blob:https://blocked.invalid/not-local",
        });
      }),
  );
  expect(rejected).toBe(true);
  expect(remote).toBe(false);
  expect(workers.length).toBe(before + 1);
});
