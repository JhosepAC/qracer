import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "apps/web/dist");
const chunks = JSON.parse(await readFile(resolve(dist, ".vite/manifest.json"), "utf8"));
const selected = new Set(["/play/", "/LICENSE.txt", "/THIRD_PARTY_NOTICES.txt"]);
function collect(key) {
  const chunk = chunks[key];
  if (!chunk || selected.has(`/${chunk.file}`)) return;
  selected.add(`/${chunk.file}`);
  for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) selected.add(`/${file}`);
  for (const child of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) collect(child);
}
collect("play/index.html");
for (const folder of ["fonts", "coast", "world"]) {
  for (const entry of await readdir(resolve(dist, "assets", folder), { withFileTypes: true })) {
    if (entry.isFile() && /\.(woff2|glb|wasm|js)$/.test(entry.name))
      selected.add(`/assets/${folder}/${entry.name}`);
  }
}
const entries = [];
for (const url of [...selected].sort()) {
  const data = await readFile(resolve(dist, `.${url === "/play/" ? "/play/index.html" : url}`));
  entries.push({
    url,
    size: data.length,
    hash: createHash("sha256").update(data).digest("hex"),
    optional: /\/world\/(city|desert)\.glb$/.test(url),
  });
}
const manifest = {
  version: 1,
  id: createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 20),
  entries,
};
await build({
  configFile: false,
  logLevel: "warn",
  define: { __QRACER_OFFLINE__: JSON.stringify(manifest) },
  build: {
    write: true,
    emptyOutDir: false,
    outDir: dist,
    target: "es2022",
    lib: {
      entry: resolve(root, "apps/web/worker/offline.ts"),
      name: "QRacerOffline",
      formats: ["iife"],
      fileName: () => "sw.js",
    },
  },
});
await writeFile(resolve(dist, ".vite/offline.json"), JSON.stringify(manifest, null, 2));
console.log(`Offline build ${manifest.id}: ${entries.length} allowlisted resources.`);
