import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.argv[2] ?? "artifacts/race-benchmark/report.json");
const report = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(report.runs)) throw new Error("Missing benchmark runs");
const atMost = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit + 1e-6;
const checks = [];
const check = (name, passed, observed, limit) => checks.push({ name, passed, observed, limit });
const limits = {
  low: [33.4, 80, 150000, 1280, 720],
  balanced: [16.7, 120, 300000, 1920, 1080],
  high: [16.7, 180, 500000, 1920, 1080],
};
for (const [profile, [frameMs, calls, triangles, width, height]] of Object.entries(limits)) {
  const runs = report.runs.filter((run) => run.profile === profile);
  check(`${profile}/repetitions`, runs.length >= 3, runs.length, 3);
  for (const run of runs) {
    const key = `${profile}/${run.run}`;
    // Only floating-point subtraction noise is tolerated, never a 16.8 ms sample.
    check(
      `${key}/frame-p95`,
      run.frames.samples > 0 && atMost(run.frames.p95, frameMs),
      run.frames.p95,
      frameMs,
    );
    check(
      `${key}/cpu-p95`,
      run.mainThreadCallback.samples > 0 && atMost(run.mainThreadCallback.p95, 10),
      run.mainThreadCallback.p95,
      10,
    );
    check(
      `${key}/duration`,
      run.elapsedMs >= 300000 && run.measuredMs >= 270000,
      run.elapsedMs,
      300000,
    );
    for (const [biome, data] of Object.entries(run.framesByBiome ?? {}))
      check(
        `${key}/${biome}/frame-p95`,
        data.samples > 0 && atMost(data.p95, frameMs),
        data.p95,
        frameMs,
      );
    check(
      `${key}/all-biomes`,
      ["coast", "desert", "city"].every((biome) => run.biomes.includes(biome)),
      run.biomes,
      "coast,desert,city",
    );
    const stats = run.renderer;
    check(`${key}/draw-calls`, atMost(stats.calls, calls), stats.calls, calls);
    check(`${key}/triangles`, atMost(stats.triangles, triangles), stats.triangles, triangles);
    check(
      `${key}/resolution`,
      atMost(stats.width, width) && atMost(stats.height, height),
      [stats.width, stats.height],
      [width, height],
    );
    check(
      `${key}/texture-estimate`,
      atMost(stats.textureBytesEstimate, 128 * 2 ** 20),
      stats.textureBytesEstimate,
      128 * 2 ** 20,
    );
    check(
      `${key}/floating-origin`,
      stats.worldOrigin >= 10000 && stats.localCoordinateMax < 1024,
      [stats.worldOrigin, stats.localCoordinateMax],
      "origin >= 10000 m; local < 1024 m",
    );
    check(
      `${key}/errors`,
      run.errors.length === 0 && !run.gpuDisjoint,
      run.errors,
      "none; valid GPU timer samples",
    );
    const resources = new Set(
      // Lazy geometry uploads on first encounters are bounded; audit the latter half
      // after visiting every biome, without excluding those frames from FPS statistics.
      run.resources
        .filter((point) => point.seconds >= run.measuredMs / 2000)
        .map((point) => `${point.geometries}/${point.textures}`),
    );
    check(
      `${key}/resource-plateau`,
      resources.size === 1,
      [...resources],
      "one stable count in the latter half after all biomes were visited",
    );
  }
}
check("native-warmup", report.conditions.warmup >= 30, report.conditions.warmup, 30);
check(
  "stability/play",
  report.stability?.simulatedSeconds >= 1800,
  report.stability?.simulatedSeconds,
  1800,
);
for (const field of ["restarts", "rebuilds"]) {
  const points = report.stability?.[field] ?? [];
  check(`stability/${field}`, points.length >= 20, points.length, 20);
  check(
    `stability/${field}/heap`,
    points.length > 0 &&
      points.every((point) => point.usedSize <= 150 * 2 ** 20 && point.canvases === 1),
    points.map((point) => point.usedSize),
    150 * 2 ** 20,
  );
  const counts = new Set(points.map((point) => `${point.nodes}/${point.jsEventListeners}`));
  check(
    `stability/${field}/dom-listeners`,
    counts.size === 1,
    [...counts],
    "stable within comparable checkpoints",
  );
}
const result = {
  sourceCommit: report.sourceCommit,
  sourceTree: report.sourceTree,
  manifestSha256: report.manifestSha256,
  passed: checks.every((check) => check.passed),
  checks,
  limitations: [
    "Only the adapter recorded by this report was measured.",
    "Heap trend and native-object retention require review of the raw checkpoints and snapshots.",
    "This report does not certify physical phone latency or other hardware.",
  ],
};
await writeFile(
  path.endsWith(".json") ? `${path.slice(0, -5)}.acceptance.json` : `${path}.acceptance.json`,
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      passed: result.passed,
      checks: checks.length,
      failures: checks.filter((check) => !check.passed),
    },
    null,
    2,
  ),
);
if (!result.passed) process.exitCode = 1;
