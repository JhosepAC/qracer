import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeLicenses } from "./licenses.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const notices = await writeLicenses();
const output = join(root, "apps/web/dist");
await Promise.all([
  copyFile(join(notices, "THIRD_PARTY_NOTICES.txt"), join(output, "THIRD_PARTY_NOTICES.txt")),
  copyFile(join(root, "LICENSE"), join(output, "LICENSE.txt")),
]);
console.log("Web distribution includes project/asset MIT license and full dependency notices.");
