import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

async function assess(change, auditChange) {
  const dir = await mkdtemp(join(tmpdir(), "qracer-report-"));
  try {
    const sample = { samples: 100, p95: 16.70000000001 };
    const point = {
      usedSize: 10000000,
      canvases: 1,
      nodes: 680,
      jsEventListeners: 103,
      renderer: { simulationTick: 60 },
    };
    const report = {
      manifestSha256: "a".repeat(64),
      conditions: { warmup: 30 },
      runs: ["low", "balanced", "high"].flatMap((profile) =>
        [1, 2, 3].map((run) => ({
          profile,
          run,
          frames: { ...sample },
          mainThreadCallback: { samples: 100, p95: 2 },
          elapsedMs: 300000,
          measuredMs: 270000,
          biomes: ["coast", "desert", "city"],
          framesByBiome: { coast: { ...sample }, desert: { ...sample }, city: { ...sample } },
          renderer: {
            calls: 70,
            triangles: 100000,
            width: 1280,
            height: 720,
            textureBytesEstimate: 10000000,
            worldOrigin: 14000,
            localCoordinateMax: 326,
          },
          errors: [],
          gpuDisjoint: false,
          resources: [
            { seconds: 1, geometries: 80, textures: 6 },
            { seconds: 150, geometries: 105, textures: 6 },
            { seconds: 260, geometries: 105, textures: 6 },
          ],
        })),
      ),
      stability: {
        simulatedSeconds: 2700,
        restarts: Array.from({ length: 20 }, () => point),
        rebuilds: Array.from({ length: 20 }, () => point),
      },
    };
    change(report);
    const path = join(dir, "report.json");
    await writeFile(path, JSON.stringify(report));
    const args = ["scripts/check-race-report.mjs", path];
    if (auditChange) {
      const audit = {
        manifestSha256: report.manifestSha256,
        stability: structuredClone(report.stability),
      };
      auditChange(audit);
      const auditPath = join(dir, "audit.json");
      await writeFile(auditPath, JSON.stringify(audit));
      args.push(auditPath);
    }
    const process = spawnSync(globalThis.process.execPath, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      code: process.status,
      result: JSON.parse(await readFile(join(dir, "report.acceptance.json"), "utf8")),
    };
  } finally {
    await rm(join(dir, "audit.json"), { force: true });
    await rm(join(dir, "report.json"), { force: true });
    await rm(join(dir, "report.acceptance.json"), { force: true });
    await rmdir(dir);
  }
}
it("accepts a complete matrix with floating-point subtraction noise and bounded lazy uploads", async () => {
  expect((await assess(() => {})).code).toBe(0);
});
it("rejects 16.8 ms without rounding away a failed repetition", async () => {
  const { code, result } = await assess((report) => {
    report.runs[8].frames.p95 = 16.8;
  });
  expect(code).toBe(1);
  expect(result.checks.find((check) => check.name === "high/3/frame-p95").passed).toBe(false);
});
it("rejects missing timings and continued resource growth", async () => {
  const { code, result } = await assess((report) => {
    report.runs[0].frames.p95 = null;
    report.runs[1].resources[2].geometries++;
  });
  expect(code).toBe(1);
  expect(result.checks.filter((check) => !check.passed)).toHaveLength(2);
});

it("rejects listener accumulation across successive scene rebuilds", async () => {
  const { code, result } = await assess((report) => {
    report.stability.rebuilds = report.stability.rebuilds.map((point, index) => ({
      ...point,
      jsEventListeners: 103 + index,
    }));
  });
  expect(code).toBe(1);
  expect(
    result.checks.find((check) => check.name === "stability/rebuilds/dom-listeners").passed,
  ).toBe(false);
});

it("refuses a supplemental stability audit from a different build", async () => {
  const result = await assess(
    () => {},
    (audit) => {
      audit.manifestSha256 = "b".repeat(64);
    },
  );
  expect(result.code).toBe(1);
  expect(
    result.result.checks.find((check) => check.name === "supplemental-audit/build").passed,
  ).toBe(false);
});
