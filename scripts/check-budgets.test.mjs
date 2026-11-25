import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBudgets, forbiddenControllerModule, reachableFiles } from "./check-budgets.mjs";

describe("bundle boundary analysis", () => {
  it("visits shared, dynamic and cyclic imports once while retaining CSS", () => {
    const manifest = {
      main: { file: "main.js", imports: ["shared"], dynamicImports: ["lazy"], css: ["main.css"] },
      shared: { file: "shared.js", imports: ["main"] },
      lazy: { file: "lazy.js", imports: ["shared"] },
    };
    expect([...reachableFiles(manifest, "main")].sort()).toEqual([
      "lazy.js",
      "main.css",
      "main.js",
      "shared.js",
    ]);
  });
  it("fails closed if the build graph is incomplete", () => {
    expect(() =>
      reachableFiles({ main: { file: "main.js", imports: ["missing"] } }, "main"),
    ).toThrow("Missing build entry");
  });
  it("rejects renderer code on both operating-system path formats", () => {
    expect(
      forbiddenControllerModule("node_modules/.pnpm/three@0.187/node_modules/three/src/a.js"),
    ).toBe(true);
    expect(forbiddenControllerModule("apps\\web\\src\\play\\preview.ts")).toBe(true);
    expect(forbiddenControllerModule("packages/protocol/src/version.ts")).toBe(false);
  });
});

it("enforces the first-play total even when each asset and the whole distribution fit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qracer-budgets-"));
  const files = [
    ".vite/manifest.json",
    "bundle-report.json",
    "app.js",
    "decoder-worker.js",
    "play/index.html",
    "assets/coast/a.glb",
    "assets/coast/b.glb",
    "assets/world/traffic.glb",
    "assets/world/city.glb",
  ];
  try {
    for (const folder of [".vite", "play", "assets/coast", "assets/world"])
      await mkdir(join(dir, folder), { recursive: true });
    const entries = [
      "play/index.html",
      "controller/index.html",
      "probe/index.html",
      "probe/controller/index.html",
    ];
    await writeFile(
      join(dir, ".vite/manifest.json"),
      JSON.stringify(Object.fromEntries(entries.map((entry) => [entry, { file: "app.js" }]))),
    );
    await writeFile(join(dir, "bundle-report.json"), JSON.stringify({ "app.js": { modules: [] } }));
    await writeFile(join(dir, "app.js"), "x");
    await writeFile(join(dir, "decoder-worker.js"), "x");
    await writeFile(join(dir, "play/index.html"), "x");
    await writeFile(join(dir, "assets/coast/a.glb"), Buffer.alloc(3 * 1024 * 1024 - 30));
    await writeFile(join(dir, "assets/coast/b.glb"), Buffer.alloc(4 * 1024 * 1024 - 10));
    await writeFile(join(dir, "assets/world/traffic.glb"), Buffer.alloc(20));
    await writeFile(join(dir, "assets/world/city.glb"), Buffer.alloc(1024 * 1024));
    expect((await checkBudgets(dir)).firstPlayUncompressedBytes).toBe(8 * 1024 * 1024 - 17);
    await writeFile(join(dir, "assets/coast/b.glb"), Buffer.alloc(4 * 1024 * 1024 + 10));
    await expect(checkBudgets(dir)).rejects.toThrow("First playable download exceeds 8 MiB");
  } finally {
    for (const file of files) await rm(join(dir, file), { force: true });
    for (const folder of [".vite", "play", "assets/coast", "assets/world", "assets", ""])
      await rmdir(join(dir, folder));
  }
});
