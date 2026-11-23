import { describe, expect, it } from "vitest";
import { forbiddenControllerModule, reachableFiles } from "./check-budgets.mjs";

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
