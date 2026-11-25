import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
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
    for (const asset of chunk.assets ?? []) files.add(asset);
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
  let initialFiles = new Set();
  for (const [entry, limit] of [
    ["play/index.html", 600 * 1024],
    ["controller/index.html", 120 * 1024],
    ["probe/index.html", 600 * 1024],
    ["probe/controller/index.html", 120 * 1024],
  ]) {
    let compressed = 0;
    const files = reachableFiles(manifest, entry);
    for (const file of files) {
      const source = await readFile(join(directory, file));
      compressed += gzipSync(source).byteLength;
      if (file.endsWith(".css"))
        for (const [url] of source.toString().matchAll(/assets\/fonts\/[\w-]+\.woff2/g)) {
          files.add(url);
        }
      if (entry.includes("controller") && report[file]?.modules.some(forbiddenControllerModule)) {
        throw new Error(`Renderer code leaked into the controller: ${file}`);
      }
    }
    if (compressed > limit)
      throw new Error(`${entry}: ${compressed} compressed bytes exceeds ${limit}`);
    results[entry] = { gzipBytes: compressed, limit };
    if (entry === "play/index.html") initialFiles = new Set([...files, entry]);
  }
  let total = 0,
    firstPlayBytes = 0;
  for await (const path of assetFiles(directory)) {
    const bytes = (await readFile(path)).byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error(`Asset exceeds 8 MiB: ${path}`);
    total += bytes;
    const file = relative(directory, path).replaceAll("\\", "/");
    if (
      initialFiles.has(file) ||
      file.startsWith("assets/coast/") ||
      file.startsWith("assets/world/")
    )
      firstPlayBytes += bytes;
  }
  if (total > 35 * 1024 * 1024) throw new Error("Total download exceeds 35 MiB");
  // Conservative uncompressed upper bound: all reachable PC chunks/fonts plus
  // the coast kit and world prefetch, which can overlap initial shader warm-up.
  if (firstPlayBytes > 8 * 1024 * 1024) throw new Error("First playable download exceeds 8 MiB");
  return { entries: results, firstPlayUncompressedBytes: firstPlayBytes, totalBytes: total };
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
