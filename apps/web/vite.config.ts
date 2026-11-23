import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    manifest: true,
    target: ["chrome111", "firefox114", "safari16.4"],
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        play: fileURLToPath(new URL("./play/index.html", import.meta.url)),
        controller: fileURLToPath(new URL("./controller/index.html", import.meta.url)),
      },
    },
  },
});
