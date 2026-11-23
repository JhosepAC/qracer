import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export function reachableFiles(manifest, entry) {
  const visited = new Set();
  const files = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing build entry: ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const ref of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(ref);
  };
  visit(entry);
  return files;
}

export function forbiddenControllerModule(id) {
  return /(?:^|\/)three(?:\/|@)|(?:^|\/)rendering\/|src\/play\//i.test(id.replaceAll("\\", "/"));
}

async function* assetFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* assetFiles(path);
    else if (entry.isFile()) yield path;
  }
}

export async function checkBudgets(directory) {
  const manifest = JSON.parse(await readFile(join(directory, ".vite/manifest.json"), "utf8"));
  const report = JSON.parse(await readFile(join(directory, "bundle-report.json"), "utf8"));
  const results = {};
  for (const [entry, limit] of [
    ["play/index.html", 600 * 1024],
    ["controller/index.html", 120 * 1024],
    ["probe/index.html", 600 * 1024],
    ["probe/controller/index.html", 120 * 1024],
  ]) {
    let compressed = 0;
    for (const file of reachableFiles(manifest, entry)) {
      compressed += gzipSync(await readFile(join(directory, file))).byteLength;
      if (entry.includes("controller") && report[file]?.modules.some(forbiddenControllerModule)) {
        throw new Error(`Renderer code leaked into the controller: ${file}`);
      }
    }
    if (compressed > limit)
      throw new Error(`${entry}: ${compressed} compressed bytes exceeds ${limit}`);
    results[entry] = { gzipBytes: compressed, limit };
  }
  let total = 0;
  for await (const path of assetFiles(directory)) {
    const bytes = (await readFile(path)).byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error(`Asset exceeds 8 MiB: ${path}`);
    total += bytes;
  }
  if (total > 35 * 1024 * 1024) throw new Error("Total download exceeds 35 MiB");
  return { entries: results, totalBytes: total };
}

if (import.meta.main) {
  console.log(
    JSON.stringify(
      await checkBudgets(fileURLToPath(new URL("../apps/web/dist/", import.meta.url))),
      null,
      2,
    ),
  );
}
