import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createRelay } from "../apps/relay-local/src/server.ts";

const { values } = parseArgs({
  options: {
    profiles: { type: "string", default: "balanced,low,high" },
    runs: { type: "string", default: "3" },
    seconds: { type: "string", default: "300" },
    output: { type: "string", default: "artifacts/probe-benchmark" },
    angle: { type: "string" },
    "allow-software": { type: "boolean", default: false },
  },
});
const profiles = values.profiles.split(",");
const runs = Number(values.runs),
  seconds = Number(values.seconds);
if (
  !profiles.every((profile) => ["low", "balanced", "high"].includes(profile)) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 20 ||
  !Number.isFinite(seconds) ||
  seconds < 5 ||
  seconds > 1800
)
  throw new Error("Invalid benchmark parameters");
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const relay = createRelay({ staticDir: resolve("apps/web/dist"), allowedOrigins: [] });
const angle = values.angle ?? (process.platform === "win32" ? "d3d11" : undefined);
let browser;
const cancellation = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => cancellation.abort());
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const result = {
  experiment: "F02-render-baseline",
  mode: seconds >= 300 ? "sustained" : "smoke",
  startedUtc: new Date().toISOString(),
  complete: false,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sceneSourceSha256: await hash("apps/web/src/probe/scene.ts"),
  assets: {
    coupe: await hash("apps/web/public/assets/probe/coupe.glb"),
    coast: await hash("apps/web/public/assets/probe/coast.glb"),
  },
  browser: null,
  conditions: {
    cpu: cpus()[0]?.model,
    memoryGiB: totalmem() / 2 ** 30,
    os: release(),
    headless: true,
    angle: angle ?? "platform default",
    viewport: [1920, 1080],
    durationSeconds: seconds,
    warmupSeconds: 30,
    runsPerProfile: runs,
  },
  runs: [],
};
const save = () =>
  writeFile(resolve(output, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
async function report(page) {
  return page.evaluate(
    () =>
      new Promise((done) => {
        const node = document.getElementById("viewport");
        node.addEventListener("probe-report-result", (event) => done(event.detail), { once: true });
        node.dispatchEvent(new Event("probe-report"));
      }),
  );
}
try {
  await new Promise((done) => relay.server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, args: angle ? [`--use-angle=${angle}`] : [] });
  result.browser = browser.version();
  for (const profile of profiles)
    for (let run = 1; run <= runs; run++) {
      if (cancellation.signal.aborted) throw new Error("Benchmark cancelled");
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const address = relay.server.address();
      await page.goto(`http://127.0.0.1:${address.port}/probe/?benchmark=1&quality=${profile}`);
      await page.waitForSelector('#viewport[data-graphics="ready"]', { timeout: 45000 });
      await page.waitForTimeout(2000);
      let current = await report(page);
      if (!current || (current.software && !values["allow-software"]))
        throw new Error(
          "Hardware renderer required; software results cannot validate a physical GPU",
        );
      console.log(`${profile} ${run}/${runs}: ${current.gpu}`);
      await page.screenshot({ path: resolve(output, `${profile}-${run}.png`) });
      let nextLog = 60;
      while (current.activeSeconds < seconds) {
        if (cancellation.signal.aborted) throw new Error("Benchmark cancelled");
        await page.waitForTimeout(2000);
        current = await report(page);
        if (current.activeSeconds >= nextLog) {
          console.log(
            `${profile} ${run}: ${Math.round(current.activeSeconds)} s, frame p95 ${current.frames.p95Ms} ms`,
          );
          nextLog += 60;
        }
      }
      const heap = await page.evaluate(() =>
        performance.memory
          ? {
              used: performance.memory.usedJSHeapSize,
              total: performance.memory.totalJSHeapSize,
            }
          : null,
      );
      result.runs.push({ run, ...current, heap, errors, completedUtc: new Date().toISOString() });
      await save();
      await page.close();
    }
  result.complete = true;
} finally {
  result.finishedUtc = new Date().toISOString();
  await Promise.allSettled([browser?.close(), relay.close()]);
  await save();
}
