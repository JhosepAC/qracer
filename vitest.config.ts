import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/relay-local/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
    testTimeout: 10000,
  },
});
