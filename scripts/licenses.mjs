import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function locatePackage(manifest, name) {
  let folder = dirname(createRequire(manifest).resolve(name));
  while (folder !== parse(folder).root) {
    try {
      const metadata = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
      if (metadata.name === name) return { folder, metadata };
    } catch {
      /* Entry point may be inside build/src. Continue toward the package root. */
    }
    folder = dirname(folder);
  }
  throw new Error(`Cannot locate license metadata for ${name}`);
}

export async function writeLicenses() {
  const records = new Map();
  const visit = async (manifest, name, includeDependencies = true) => {
    const { folder, metadata } = await locatePackage(manifest, name);
    const key = `${metadata.name}@${metadata.version}`;
    if (records.has(key)) return;
    let licenseText;
    for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT"]) {
      try {
        licenseText = await readFile(join(folder, file), "utf8");
        break;
      } catch {
        /* Try supported names. */
      }
    }
    if (!licenseText || !metadata.license) throw new Error(`Missing license for ${key}`);
    records.set(key, {
      name: metadata.name,
      version: metadata.version,
      license: metadata.license,
      text: licenseText,
    });
    if (includeDependencies) {
      for (const dependency of Object.keys(metadata.dependencies ?? {}))
        await visit(join(folder, "package.json"), dependency);
    }
  };
  for (const group of ["apps", "packages"]) {
    for (const folder of await readdir(join(root, group))) {
      const manifest = join(root, group, folder, "package.json");
      const metadata = JSON.parse(await readFile(manifest, "utf8"));
      for (const [name, version] of Object.entries(metadata.dependencies ?? {})) {
        if (!version.startsWith("workspace:")) await visit(manifest, name);
      }
    }
  }
  // Vite injects its MIT-licensed module-preload helper into browser output.
  await visit(join(root, "package.json"), "vite", false);
  const entries = [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
  const output = join(root, "artifacts/licenses");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "licenses.json"),
    JSON.stringify(
      entries.map(({ text: _, ...item }) => item),
      null,
      2,
    ),
  );
  await writeFile(
    join(output, "THIRD_PARTY_NOTICES.txt"),
    entries
      .map((item) => `${item.name}@${item.version}\n${item.license}\n\n${item.text}`)
      .join("\n\n---\n\n"),
  );
  return output;
}

if (import.meta.main) console.log(`Runtime license inventory: ${await writeLicenses()}`);
