import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const credentials =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b|\bnpm_[A-Za-z0-9]{36,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;
export function privateBuildValues(env) {
  return Object.entries(env)
    .filter(
      ([key, value]) =>
        /(?:^|_)(?:TOKEN|KEY|SECRET|PASSWORD)$/.test(key) &&
        !/^(?:PUBLIC_|VITE_)/.test(key) &&
        typeof value === "string" &&
        value.length >= 16,
    )
    .map(([, value]) => value);
}
/** Detect common credential formats and known private build values; no secret is printed. */
export async function checkSecrets(root, privateValues = []) {
  let files = 0;
  const findings = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        findings.push({ file: name, reason: "symlink" });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      files++;
      if (/(?:^|\/)\.(?:env|dev\.vars)(?:\.|$)|\.(?:pem|key|p12|pfx)$/.test(name)) {
        findings.push({ file: name, reason: "private-file" });
        continue;
      }
      if (!/\.(?:[cm]?js|html|css|json|txt|md)$/.test(name)) continue;
      const text = await readFile(path, "utf8");
      if (credentials.test(text) || privateValues.some((value) => text.includes(value)))
        findings.push({ file: name, reason: "credential" });
    }
  }
  await walk(root);
  return { files, findings };
}
if (import.meta.main) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const values = privateBuildValues(process.env);
  for (const dir of ["apps/web/dist", "apps/relay-local/dist", "apps/relay-cloudflare/dist"]) {
    const report = await checkSecrets(join(root, dir), values);
    if (report.findings.length)
      throw new Error(
        `Distribution security check failed: ${dir}; ${JSON.stringify(report.findings)}`,
      );
    console.log(
      `Distribution security check: ${dir}; ${report.files} files; no detected credentials.`,
    );
  }
}
