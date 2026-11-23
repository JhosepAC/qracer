import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/server.ts",
    target: "node24",
    outDir: "dist",
    rollupOptions: { output: { entryFileNames: "server.mjs" } },
  },
  ssr: { noExternal: true },
});
