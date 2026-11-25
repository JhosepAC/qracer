import { expect, it } from "vitest";
import { offlineRevision } from "./offline-build.mjs";
import { securityBuild } from "./security-build.ts";

it("emits matching Pages headers and public origins without overlapping sensor directives", () => {
  const plugin = securityBuild();
  plugin.configResolved({
    env: { VITE_SESSION_RELAY: "https://relay.example", VITE_PROBE_RELAY: "https://probe.example" },
  });
  const files = {};
  plugin.generateBundle.call({
    emitFile(file) {
      files[file.fileName] = file.source;
    },
  });
  expect(JSON.parse(files["security-origins.json"])).toEqual([
    "https://relay.example",
    "https://probe.example",
  ]);
  expect(files._headers).toContain("wss://relay.example");
  expect(files._headers).toContain(
    "/controller/\n  Permissions-Policy: accelerometer=(self), gyroscope=(self)",
  );
  expect(files._headers).toContain("/play/\n  Permissions-Policy: accelerometer=(), gyroscope=()");
  const global = files._headers.split("\n\n")[0];
  expect(global).not.toMatch(/accelerometer|gyroscope/);
  expect(global).not.toContain("'unsafe-eval'");
  expect(files._headers).toContain("! Content-Security-Policy");
  expect(files._headers).toContain("connect-src 'none'; worker-src 'none'");
});
it("rejects a relay URL that could disclose credentials or inject a policy", () => {
  expect(() =>
    securityBuild().configResolved({ env: { VITE_SESSION_RELAY: "https://secret@relay.example" } }),
  ).toThrow();
});

it("rejects unreviewed public secrets and whole-environment substitutions without echoing values", () => {
  for (const config of [
    { env: { VITE_SESSION_KEY: "sensitive-build-secret" } },
    { env: {}, define: { "process.env": '{"TOKEN":"sensitive-build-secret"}' } },
    { env: {}, define: { "import.meta.env": '{"TOKEN":"sensitive-build-secret"}' } },
  ]) {
    expect(() => securityBuild().configResolved(config)).toThrow();
    try {
      securityBuild().configResolved(config);
    } catch (error) {
      expect(error.message).not.toContain("sensitive-build-secret");
    }
  }
});

it("rejects a generated policy longer than Pages can enforce", () => {
  const plugin = securityBuild();
  plugin.configResolved({ env: { VITE_SESSION_RELAY: `https://${"a".repeat(2000)}.example` } });
  expect(() => plugin.generateBundle.call({ emitFile() {} })).toThrow("Pages line limit");
});

it("revises cached HTML when security headers change without changing an asset", () => {
  const entries = [{ url: "/play/", hash: "unchanged", size: 100 }];
  const before = offlineRevision(entries, "default-src 'self'");
  expect(offlineRevision(entries, "default-src 'self'")).toBe(before);
  expect(offlineRevision(entries, "script-src 'self'; frame-ancestors 'none'")).not.toBe(before);
});
