import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { bundleReport } from "../../scripts/bundle-report.ts";
import { securityBuild } from "../../scripts/security-build.ts";

export default defineConfig({
  plugins: [bundleReport(), securityBuild()],
  build: {
    manifest: true,
    target: ["chrome111", "firefox114", "safari16.4"],
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        play: fileURLToPath(new URL("./play/index.html", import.meta.url)),
        controller: fileURLToPath(new URL("./controller/index.html", import.meta.url)),
        probe: fileURLToPath(new URL("./probe/index.html", import.meta.url)),
        probeController: fileURLToPath(new URL("./probe/controller/index.html", import.meta.url)),
      },
    },
  },
});
