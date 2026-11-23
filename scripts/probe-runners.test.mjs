import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = "a".repeat(64);
it("refuses unsafe or missing relay origins before transmitting a capability", () => {
  for (const args of [
    [],
    ["--relay", "http://public.example", "--origin", "https://frontend.example"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/soak-probe.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, QRACER_PROBE_KEY: fixture },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Provide --relay|Public soak requires HTTPS/);
    expect(result.stdout + result.stderr).not.toContain(fixture);
  }
});
it("rejects an invalid benchmark duration before starting a browser", () => {
  const result = spawnSync(process.execPath, ["scripts/benchmark-probe.mjs", "--seconds", "0"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Invalid benchmark parameters");
});
