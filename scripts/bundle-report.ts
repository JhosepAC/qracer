import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export function bundleReport(): Plugin {
  const root = fileURLToPath(new URL("../", import.meta.url));
  return {
    name: "qracer-bundle-report",
    generateBundle(_, bundle) {
      const report = Object.fromEntries(
        Object.values(bundle)
          .filter((item) => item.type === "chunk")
          .map((chunk) => [
            chunk.fileName,
            {
              modules: Object.keys(chunk.modules).map((id) =>
                id.startsWith("\0")
                  ? `virtual:${id.slice(1)}`
                  : relative(root, id).replaceAll("\\", "/"),
              ),
            },
          ]),
      );
      this.emitFile({
        type: "asset",
        fileName: "bundle-report.json",
        source: JSON.stringify(report),
      });
    },
  };
}
