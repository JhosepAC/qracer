import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createRelay } from "../apps/relay-local/src/server.ts";
import { openLane } from "../packages/game-core/src/traffic.ts";
import { checkpoint, restartAudit } from "./benchmark-stability.mjs";
import { seedBenchmarkGhost } from "./ghost-fixture.mjs";

const { values } = parseArgs({
  options: {
    restarts: { type: "string", default: "20" },
    stability: { type: "boolean", default: false },
    adaptive: { type: "boolean", default: false },
    ghost: { type: "boolean", default: false },
    locale: { type: "string", default: "es" },
    environment: { type: "string", default: "coast" },
    profiles: { type: "string", default: "low,balanced,high" },
    runs: { type: "string", default: "3" },
    seconds: { type: "string", default: "300" },
    output: { type: "string", default: "artifacts/race-benchmark" },
    "allow-software": { type: "boolean", default: false },
  },
});
const profiles = values.profiles.split(",");
const runs = Number(values.runs);
const seconds = Number(values.seconds);
const restarts = Number(values.restarts);
if (
  !Number.isInteger(restarts) ||
  restarts < 1 ||
  restarts > 100 ||
  !["es", "en"].includes(values.locale) ||
  !["coast", "desert", "city"].includes(values.environment) ||
  !profiles.every((profile) => ["low", "balanced", "high"].includes(profile)) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 10 ||
  !Number.isInteger(seconds) ||
  seconds < 5 ||
  seconds > 1800 ||
  (values.ghost && seconds > 110)
)
  throw new Error("Invalid benchmark parameters");

const warmup = seconds >= 60 ? 30 : 2;
const output = resolve(values.output);
const staticDir = resolve("apps/web/dist");
await mkdir(output, { recursive: true });
const report = {
  experiment: "QRacer-world-race",
  sourceTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceDirty: Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
    }).trim(),
  ),
  manifestSha256: createHash("sha256")
    .update(await readFile(resolve(staticDir, ".vite/manifest.json")))
    .digest("hex"),
  conditions: {
    seconds,
    warmup,
    adaptive: values.adaptive,
    stability: values.stability,
    clocks: "native RAF/performance.now; no time scaling; GC only while paused",
    ghost: values.ghost ? "Synthetic offset comparison trajectory, native IndexedDB" : "disabled",
    cpu: cpus()[0]?.model,
    memoryGiB: totalmem() / 2 ** 30,
    os: release(),
    seed: 310,
    environment: values.environment,
    locale: values.locale,
    audio: "enabled by Play gesture; OS output may be muted by automation",
    controls: "ArrowUp + reserved lane (center for seed 310); Shift for two seconds mid-run",
    viewport: [1920, 1080],
  },
  runs: [],
};
const relay = createRelay({ staticDir, allowedOrigins: [] });
let browser;

function instrument({ profile, warmup, locale, adaptive }) {
  localStorage.setItem("qracer.locale.v1", locale);
  localStorage.setItem("qracer.graphics.quality", profile);
  localStorage.setItem("qracer.graphics.adaptive.v1", String(adaptive));
  const native = window.requestAnimationFrame.bind(window);
  const frames = [],
    work = [],
    gpu = [];
  const maxima = {};
  const biomeFrames = {};
  const biomes = new Set();
  const resources = [];
  let ghostSamples = 0;
  let resourcesAt = -Infinity;
  let start = Infinity,
    started = 0;
  let previous;
  let sampledAt = -Infinity;
  let gl, extension;
  let disrupted = false;
  const queries = [];
  let longest = 0;
  let taskCount = 0;
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < start) continue;
        longest = Math.max(longest, entry.duration);
        taskCount++;
      }
    }).observe({ type: "longtask" });
  }
  window.requestAnimationFrame = (callback) =>
    native((now) => {
      if (now < start) return callback(now);
      if (previous !== undefined) {
        const interval = now - previous;
        frames.push(interval);
        const biome = document.querySelector("#preview").dataset.biome ?? "unknown";
        biomeFrames[biome] ??= [];
        biomeFrames[biome].push(interval);
      }
      previous = now;
      const before = performance.now();
      let query;
      if (extension) {
        if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
          disrupted = true;
          while (queries.length) gl.deleteQuery(queries.shift());
        }
        while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
          const item = queries.shift();
          gpu.push(gl.getQueryParameter(item, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(item);
        }
        if (queries.length < 8) {
          query = gl.createQuery();
          if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
        }
      }
      callback(now);
      if (query) {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        queries.push(query);
      }
      work.push(performance.now() - before);
      if (now - sampledAt >= 100) {
        const current = JSON.parse(document.getElementById("preview").dataset.renderStats ?? "{}");
        if (current.ghostVisible) ghostSamples++;
        for (const [key, value] of Object.entries(current))
          if (typeof value === "number") maxima[key] = Math.max(maxima[key] ?? 0, value);
        const biome = document.getElementById("preview").dataset.biome;
        if (biome) biomes.add(biome);
        if (now - resourcesAt >= 1000) {
          resources.push({
            seconds: (now - start) / 1000,
            biome,
            geometries: current.geometries,
            textures: current.textures,
          });
          resourcesAt = now;
        }
        sampledAt = now;
      }
    });
  window.raceBenchmark = {
    begin() {
      while (queries.length) gl.deleteQuery(queries.shift());
      frames.length = work.length = gpu.length = resources.length = 0;
      for (const key of Object.keys(maxima)) delete maxima[key];
      biomes.clear();
      for (const key of Object.keys(biomeFrames)) delete biomeFrames[key];
      ghostSamples = longest = taskCount = 0;
      resourcesAt = sampledAt = -Infinity;
      previous = undefined;
      disrupted = false;
      gl = document.querySelector("#preview canvas").getContext("webgl2");
      extension = gl?.getExtension("EXT_disjoint_timer_query_webgl2");
      started = performance.now();
      start = started + warmup * 1000;
    },
    finish() {
      const ended = performance.now();
      start = Infinity;
      const gpuAvailable = !!extension;
      const pendingGpuQueries = queries.length;
      while (queries.length) gl.deleteQuery(queries.shift());
      gl = extension = undefined;
      const summarize = (data) => {
        const sorted = [...data].sort((a, b) => a - b);
        const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
        return {
          samples: sorted.length,
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
          slow50: sorted.filter((value) => value > 50).length,
        };
      };
      const transferBytes = performance
        .getEntriesByType("resource")
        .reduce(
          (sum, entry) => sum + entry.transferSize,
          performance.getEntriesByType("navigation")[0]?.transferSize ?? 0,
        );
      return {
        measuredMs: ended - started - warmup * 1000,
        elapsedMs: ended - started,
        frames: summarize(frames),
        mainThreadCallback: summarize(work),
        gpu: gpuAvailable ? summarize(gpu) : null,
        pendingGpuQueriesDiscarded: pendingGpuQueries,
        gpuDisjoint: disrupted,
        longTasks: { count: taskCount, maximumMs: longest },
        renderer: maxima,
        ghostSamples,
        biomes: [...biomes],
        framesByBiome: Object.fromEntries(
          Object.entries(biomeFrames).map(([key, data]) => [key, summarize(data)]),
        ),
        resources,
        transferBytes,
        distance: document.getElementById("distance").textContent,
        mode: document.getElementById("app").dataset.mode,
      };
    },
  };
}

const save = () =>
  writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
try {
  await new Promise((done) => relay.server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({
    args: process.platform === "win32" ? ["--use-angle=d3d11"] : [],
  });
  report.browser = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  const system = await cdp.send("SystemInfo.getInfo");
  report.adapter = system.gpu.auxAttributes?.glRenderer ?? null;
  if (
    (!report.adapter || /swiftshader|llvmpipe|software/i.test(report.adapter)) &&
    !values["allow-software"]
  )
    throw new Error(`Expected hardware WebGL: ${report.adapter}`);

  const { port } = relay.server.address();
  const origin = `http://127.0.0.1:${port}`;
  let sharedPage;
  const sharedErrors = [];
  report.checkpoints = [];
  for (const profile of profiles) {
    for (let run = 1; run <= runs; run++) {
      const page =
        sharedPage ?? (await browser.newPage({ viewport: { width: 1920, height: 1080 } }));
      const fresh = page !== sharedPage;
      const errors = values.stability ? sharedErrors : [];
      errors.length = 0;
      if (fresh) page.on("pageerror", (error) => errors.push(error.message));
      if (fresh)
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
      try {
        if (fresh) {
          await page.addInitScript(instrument, {
            profile,
            warmup,
            locale: values.locale,
            adaptive: values.adaptive,
          });
          if (values.ghost) await seedBenchmarkGhost(page, origin, seconds);
          await page.goto(`${origin}/play/`);
        } else {
          await page.locator("#return-menu").click();
          await page.waitForSelector('#preview[data-graphics="ready"]');
          if ((await page.locator("#graphics-quality").inputValue()) !== profile)
            await page.locator("#graphics-quality").selectOption(profile);
        }
        if (values.stability) sharedPage = page;
        await page.waitForSelector(`#preview[data-graphics="ready"][data-quality="${profile}"]`);
        if (values.environment !== "coast") {
          await page.locator("#run-biome").selectOption(values.environment);
          await page.waitForSelector(
            `#preview[data-graphics="ready"][data-biome="${values.environment}"]`,
          );
        }
        if (values.ghost) await page.locator("#run-mode").selectOption("time-trial");
        if (run === 1) await page.screenshot({ path: resolve(output, `${profile}-menu.png`) });
        await page.locator("#start").click();
        await page.keyboard.down("ArrowUp");
        const lane = openLane(310);
        if (lane !== 1) await page.keyboard.down(lane === 0 ? "ArrowLeft" : "ArrowRight");
        await page.evaluate(() => window.raceBenchmark.begin());
        const wait = async (ms) => {
          while (ms > 0) {
            const chunk = Math.min(ms, 30000);
            await page.waitForTimeout(chunk);
            ms -= chunk;
            console.log(`progress ${profile}/${run}: ${new Date().toISOString()}`);
          }
        };
        await wait(Math.floor(seconds * 500));
        await page.keyboard.down("Shift");
        await page.waitForTimeout(2000);
        await page.keyboard.up("Shift");
        await wait(Math.max(0, Math.ceil(seconds * 500) - 2000));
        const result = await page.evaluate(() => window.raceBenchmark.finish());
        report.runs.push({ profile, run, ...result, errors: [...errors] });
        console.log(profile, run, result.frames, result.renderer, result.distance, errors);
        if (run === 1) await page.screenshot({ path: resolve(output, `${profile}-race.png`) });
        await save();
        if (result.mode !== "playing" || errors.length || (values.ghost && !result.ghostSamples))
          throw new Error(`Invalid run: ${profile}/${run}`);
        await page.keyboard.up("ArrowUp");
        await page.keyboard.up("ArrowLeft");
        await page.keyboard.up("ArrowRight");
        await page.keyboard.press("Escape");
        if (values.stability) report.checkpoints.push(await checkpoint(page, `${profile}/${run}`));
        await save();
      } finally {
        if (!values.stability) await page.close();
      }
    }
  }
  if (values.stability) {
    report.stability = await restartAudit(sharedPage, output, restarts);
    report.stability.activeElapsedMs = report.runs.reduce((sum, run) => sum + run.elapsedMs, 0);
    report.stability.simulatedSeconds = report.runs.reduce(
      (sum, run) => sum + run.renderer.simulationTick / 60,
      0,
    );
    await save();
  }
} finally {
  await browser?.close();
  relay.server.close();
  await save();
}
