import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkSecrets, privateBuildValues } from "./check-secrets.mjs";

it("finds accidental credentials and forbidden files without exposing their contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qracer-secrets-"));
  const secret = "fixture-private-value-123456";
  const files = {
    "clean.js": "const publicUrl='https://relay.example'",
    "oops.js": `const token='${secret}'`,
    ".env": "not-for-distribution",
    "key.txt": ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    "github.js": `const value='ghp_${"a".repeat(36)}'`,
  };
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    const report = await checkSecrets(dir, [secret]);
    expect(report.files).toBe(5);
    expect(report.findings.map((finding) => finding.file).sort()).toEqual([
      ".env",
      "github.js",
      "key.txt",
      "oops.js",
    ]);
    expect(JSON.stringify(report)).not.toContain(secret);
  } finally {
    for (const name of Object.keys(files)) await rm(join(dir, name), { force: true });
    await rmdir(dir);
  }
});
it("selects private environment values without confusing public origins or short configuration", () => {
  expect(
    privateBuildValues({
      SESSION_KEY: "fixture-private-value-123456",
      VITE_SESSION_RELAY: "https://relay.example",
      PUBLIC_KEY: "public-key-value-123456",
      NODE_OPTIONS: "some non-secret configuration",
      TOKEN: "short",
    }),
  ).toEqual(["fixture-private-value-123456"]);
});
