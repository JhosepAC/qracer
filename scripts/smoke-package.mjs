import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const archive = join(root, "artifacts/qracer-local-0.1.0.tar.gz");
const expected = (await readFile(`${archive}.sha256`, "utf8")).split(" ")[0];
const actual = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
if (actual !== expected) throw new Error("Local archive checksum mismatch");
// Extract outside the checkout so a missing bundled dependency cannot resolve from node_modules.
const isolated = await mkdtemp(join(tmpdir(), "qracer-package-"));
execFileSync("tar", ["-xzf", archive, "-C", isolated], { windowsHide: true });
const { createRelay } = await import(pathToFileURL(join(isolated, "server.mjs")).href);
const relay = createRelay({ staticDir: join(isolated, "web"), allowedOrigins: [] });
await new Promise((done) => relay.server.listen(0, "127.0.0.1", done));
try {
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  const health = await (await fetch(`${origin}/health`)).json();
  if (health.status !== "ok") throw new Error("Packaged server health failed");
  for (const path of ["/play/", "/controller/"]) {
    const response = await fetch(`${origin}${path}`);
    if (response.status !== 200 || !(await response.text()).includes('id="app"')) {
      throw new Error(`Packaged entry failed: ${path}`);
    }
  }
  if ((await fetch(`${origin}/.env`)).status !== 404) throw new Error("Hidden file route exposed");
  const manifest = JSON.parse(
    await readFile(join(root, "apps/web/dist/.vite/offline.json"), "utf8"),
  );
  const worker = await fetch(`${origin}/sw.js`);
  if (
    !worker.ok ||
    !worker.headers.get("content-type")?.includes("javascript") ||
    !(await worker.text()).includes(manifest.id)
  )
    throw new Error("Packaged offline worker is missing or mismatched");
  await Promise.all(
    manifest.entries.map(async (entry) => {
      const response = await fetch(`${origin}${entry.url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        !response.ok ||
        bytes.length !== entry.size ||
        createHash("sha256").update(bytes).digest("hex") !== entry.hash
      )
        throw new Error(`Packaged offline resource mismatch: ${entry.url}`);
    }),
  );
  console.log(
    "Archive checksum, offline manifest assets and isolated server/desktop/controller smoke passed.",
  );
} finally {
  await relay.close();
}
