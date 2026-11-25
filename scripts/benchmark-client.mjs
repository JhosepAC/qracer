import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createRelay } from "../apps/relay-local/src/server.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "48231" },
    seconds: { type: "string", default: "60" },
    route: { type: "string", default: "both" },
    mode: { type: "string", default: "both" },
    output: { type: "string", default: "artifacts/client-benchmark" },
  },
});
const seconds = Number(values.seconds);
if (
  !Number.isInteger(seconds) ||
  seconds < 10 ||
  seconds > 3600 ||
  !["direct", "relay", "both"].includes(values.route) ||
  !["startup", "controller", "both"].includes(values.mode)
)
  throw new Error("Invalid parameters");
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port");
const origin = `http://127.0.0.1:${port}`;
const relay = createRelay({ staticDir: resolve("apps/web/dist"), allowedOrigins: [origin] });
const report = {
  sourceTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  manifestSha256: createHash("sha256")
    .update(await readFile("apps/web/dist/.vite/manifest.json"))
    .digest("hex"),
  harnessSha256: createHash("sha256")
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex"),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  conditions: {
    seconds,
    origin: "loopback; not LAN/phone hardware",
    clocks: "native monotonic clocks",
    controller: "two CPU-only Chromium contexts; renderer stub isolates input/transport work",
    sensors: "direct route uses synthetic orientation events and a granted-permission stub",
  },
  startup: [],
  controller: [],
};
let browser;
const save = () =>
  writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
async function diagnostic(page, selector, name) {
  const waiting = page.waitForEvent("download");
  await page.locator(selector).click();
  const path = await (await waiting).path();
  if (!path) throw new Error("Diagnostic download failed");
  const text = await readFile(path, "utf8");
  if (/token|sdp|candidate|gamma|beta/.test(text)) throw new Error("Sensitive diagnostic");
  await writeFile(resolve(output, name), text);
  return JSON.parse(text);
}
async function heap(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(50);
    await cdp.send("HeapProfiler.collectGarbage");
    return {
      ...(await cdp.send("Runtime.getHeapUsage")),
      ...(await cdp.send("Memory.getDOMCounters")),
    };
  } finally {
    await cdp.detach();
  }
}
try {
  await new Promise((done, reject) => {
    relay.server.once("error", reject);
    relay.server.listen(port, "127.0.0.1", done);
  });
  if (values.mode !== "controller") {
    browser = await chromium.launch({
      args: process.platform === "win32" ? ["--use-angle=d3d11"] : [],
    });
    for (const entry of ["controller", "play"])
      for (let run = 1; run <= 3; run++) {
        const mobile = entry === "controller";
        const page = await browser.newPage({
          viewport: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
          isMobile: mobile,
          hasTouch: mobile,
        });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: mobile ? 100 : 80,
          downloadThroughput: ((mobile ? 10 : 20) * 1e6) / 8,
          uploadThroughput: 1e6 / 8,
        });
        await page.addInitScript(() => localStorage.setItem("qracer.offline.enabled.v1", "false"));
        await page.goto(`${origin}/${entry}/`);
        await page.waitForSelector(mobile ? "#join-form" : '#preview[data-graphics="ready"]');
        const result = await page.evaluate(() => ({
          readyMs: performance.now(),
          transferBytes: performance
            .getEntriesByType("resource")
            .reduce((sum, resource) => sum + resource.transferSize, 0),
          renderer: JSON.parse(document.querySelector("#preview")?.dataset.renderStats || "{}"),
        }));
        report.startup.push({ entry, run, ...result, limitMs: mobile ? 3000 : 10000 });
        await page.close();
        await save();
      }
    await browser.close();
    browser = undefined;
    if (report.startup.some((run) => run.readyMs > run.limitMs))
      throw new Error("Startup budget exceeded");
  }
  if (values.mode !== "startup") {
    browser = await chromium.launch({ args: ["--disable-gpu"] });
    report.browser = browser.version();
    for (const route of values.route === "both" ? ["direct", "relay"] : [values.route]) {
      const pc = await browser.newPage({ viewport: { width: 480, height: 320 } });
      const phone = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const errors = [];
      for (const page of [pc, phone]) page.on("pageerror", (error) => errors.push(error.message));
      await pc.route("**/assets/race-view-*.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `
        export async function createRaceView(container) {
          const canvas = document.createElement("canvas"); container.append(canvas);
          return { canvas, draw(){}, stats: () => ({}), dispose: () => canvas.remove() };
        }`,
        }),
      );
      for (const page of [pc, phone])
        await page.addInitScript(() => localStorage.setItem("qracer.offline.enabled.v1", "false"));
      if (route === "direct")
        await phone.addInitScript(() => {
          Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
            value: async () => "granted",
          });
        });
      if (route === "relay")
        await phone.addInitScript(() => {
          delete window.RTCPeerConnection;
        });
      await pc.goto(`${origin}/play/`);
      await pc.locator("#run-mode").selectOption("practice");
      await pc.locator("#host-pair").click();
      await pc.getByRole("button", { name: "Generar invitación" }).click();
      await pc.locator("#host-link").waitFor();
      await phone.goto(await pc.locator("#host-link").inputValue());
      await pc.getByRole("button", { name: "Aprobar mando" }).click();
      await pc.getByRole("button", { name: "Cerrar panel" }).click();
      await phone.waitForSelector("#drive-shell");
      await pc.waitForFunction(
        (route) =>
          document.documentElement.dataset.transport === (route === "direct" ? "rtc" : "wss"),
        route,
      );
      await pc.locator("#start-mobile").click();
      await phone.waitForFunction(() =>
        document.querySelector("#drive-state").textContent.includes("En carrera"),
      );
      const before = await heap(phone);
      if (route === "direct") await phone.locator("#activate-tilt").click();
      await phone.evaluate((tilt) => {
        const wheel = document.querySelector("[data-drive=wheel]");
        const box = wheel.getBoundingClientRect();
        const center = box.left + box.width / 2;
        window.controllerBench = setInterval(() => {
          const delta = Math.sin(performance.now() / 1000) * 0.02;
          if (tilt)
            window.dispatchEvent(
              new DeviceOrientationEvent("deviceorientation", { beta: 0, gamma: delta }),
            );
          else {
            wheel.dispatchEvent(
              new PointerEvent("pointerdown", { pointerId: 2, button: 0, clientX: center + delta }),
            );
            wheel.dispatchEvent(
              new PointerEvent("pointermove", { pointerId: 2, clientX: center + delta }),
            );
          }
        }, 16);
      }, route === "direct");
      if (route === "direct")
        await phone.waitForFunction(() =>
          document.querySelector("#tilt-status").textContent.includes("Inclinación activa"),
        );
      await phone
        .getByRole("button", { name: "Acelerar", exact: true })
        .dispatchEvent("pointerdown", { pointerId: 1, button: 0 });
      let interruption = "";
      const started = await phone.evaluate(() => performance.now());
      for (let elapsed = 0; elapsed < seconds; elapsed += 30) {
        await phone.waitForTimeout(Math.min(30, seconds - elapsed) * 1000);
        const progress = {
          route,
          elapsed: Math.min(elapsed + 30, seconds),
          at: new Date().toISOString(),
          mode: await pc.locator("#app").getAttribute("data-mode"),
          approximateHeap: await phone.evaluate(() => performance.memory?.usedJSHeapSize ?? null),
        };
        console.log("controller", progress);
        await writeFile(resolve(output, "progress.json"), JSON.stringify(progress));
        if (progress.mode !== "playing") {
          interruption =
            (await pc.locator("#summary").textContent()) || `Unexpected mode: ${progress.mode}`;
          break;
        }
      }
      const elapsedMs =
        (await phone.evaluate(() => {
          clearInterval(window.controllerBench);
          return performance.now();
        })) - started;
      if ((await pc.locator("#app").getAttribute("data-mode")) === "playing") {
        await phone.getByRole("button", { name: "Pausa", exact: true }).click();
        await pc.waitForSelector('#app[data-mode="paused"]');
      }
      await phone.getByText("Ajustes y diagnóstico", { exact: true }).click();
      const handset = await diagnostic(phone, "#drive-diagnostic", `${route}-handset.json`);
      const after = await heap(phone);
      if ((await pc.locator("#app").getAttribute("data-mode")) !== "menu")
        await pc.locator("#return-menu").click();
      await pc.getByRole("button", { name: "Datos locales", exact: true }).click();
      const host = await diagnostic(pc, "#data-performance", `${route}-host.json`);
      report.controller.push({
        route,
        elapsedMs,
        interruption,
        handset,
        host,
        heap: { before, after },
        errors,
      });
      await save();
      if (
        interruption ||
        errors.length ||
        after.usedSize > 30 * 2 ** 20 ||
        !host.pipeline.receiptToSimulationMs.samples ||
        (route === "direct" && handset.sensors.samples < seconds * 30)
      )
        throw new Error("Controller validation failed");
      await pc.close();
      await phone.close();
    }
  }
} finally {
  await browser?.close();
  await relay.close();
  await save();
}
