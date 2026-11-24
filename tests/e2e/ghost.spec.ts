import { expect, test } from "@playwright/test";
import { createRace } from "../../packages/game-core/src/race.ts";
import { freshData } from "../../apps/web/src/storage/model.ts";
import { GhostRecorder } from "../../apps/web/src/storage/ghost.ts";

test("records a timed run and reopens its compatible ghost without affecting simulation", async ({
  page,
}) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container,_signal,options){const canvas=document.createElement("canvas");container.append(canvas);return {canvas,draw(_previous,current){container.dataset.ghostActive=String(!!options.ghost?.(current.tick));},stats:()=>({}),dispose(){canvas.remove()}};}`,
    }),
  );
  await page.addInitScript(() => {
    let time = 0;
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => {
        time += 1000 / 12;
        callback(time);
      }, 1);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto("/play/");
  await page.locator("#run-mode").selectOption("time-trial");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await expect(page.getByRole("heading", { name: "Fin de carrera" })).toBeVisible({
    timeout: 20000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((done) => {
            const req = indexedDB.open("qracer.progress");
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction("ghosts");
              const count = tx.objectStore("ghosts").count();
              count.onsuccess = () => done(count.result);
              tx.oncomplete = () => db.close();
            };
          }),
      ),
    )
    .toBe(1);
  await page.reload();
  await page.locator("#run-mode").selectOption("time-trial");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await expect(page.locator("#preview")).toHaveAttribute("data-ghost-active", "true");
  await expect(page.locator("#ghost-hud")).toBeVisible();
  await page.keyboard.press("Escape");
  const score = await page.locator("#score").textContent();
  await page.waitForTimeout(100);
  expect(await page.locator("#score").textContent()).toBe(score);
  await page.getByRole("button", { name: "Elegir otro recorrido" }).click();
  await page.locator("#run-ghost").uncheck();
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await expect(page.locator("#preview")).toHaveAttribute("data-ghost-active", "false");
  await expect(page.locator("#ghost-hud")).toBeHidden();
});

test("renders the Blender ghost silhouette in one extra low-profile draw", async ({
  page,
}, info) => {
  test.setTimeout(50000);
  await page.setViewportSize({ width: 480, height: 320 });
  const initial = createRace(310, undefined, { mode: "time-trial" });
  const recorder = new GhostRecorder(7200);
  for (let tick = 0; tick <= 7200; tick += 3)
    recorder.capture({
      ...initial,
      tick,
      phase: tick === 7200 ? "finished" : "racing",
      driver: { ...initial.driver, s: (tick / 60) * (80 / 3.6), d: Math.min(3, (tick / 60) * 3) },
    });
  const ghost = recorder.finish({ ...initial, tick: 7200, phase: "finished", score: 1 });
  if (!ghost) throw new Error("Missing fixture");
  const { buffer, ...meta } = ghost;
  const profile = freshData();
  profile.progress = { ...profile.progress, records: { [ghost.category]: 1 } };
  await page.goto("/controller/");
  await page.evaluate(
    ({ profile, meta, bytes }) =>
      new Promise<void>((done) => {
        const req = indexedDB.open("qracer.progress", 2);
        req.onupgradeneeded = () => {
          for (const name of ["state", "ghosts", "quarantine"]) req.result.createObjectStore(name);
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["state", "ghosts"], "readwrite");
          tx.objectStore("state").put(profile, "profile");
          tx.objectStore("ghosts").put(
            { ...meta, buffer: Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)).buffer },
            meta.category,
          );
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
    { profile, meta, bytes: Buffer.from(buffer).toString("base64") },
  );
  await page.addInitScript(() => {
    localStorage.setItem("qracer.graphics.quality", "low");
    localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
    const request = window.requestAnimationFrame.bind(window);
    let time = 0;
    window.requestAnimationFrame = (callback) =>
      request(() => {
        time += 1000 / 12;
        callback(time);
      });
  });
  await page.goto("/play/");
  await page.locator("#run-mode").selectOption("time-trial");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}")
          .ghostVisible,
      { timeout: 20000 },
    )
    .toBe(true);
  const stats = JSON.parse(
    (await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}",
  );
  expect(stats.calls).toBeLessThanOrEqual(80);
  expect(stats.triangles).toBeLessThanOrEqual(150000);
  await page.screenshot({ path: info.outputPath("ghost-low.png") });
  await page.keyboard.press("Escape");
  expect(await page.locator("#score").textContent()).toMatch(/^\d+$/);
});
