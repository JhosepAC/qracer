import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "pnpm dev:local",
    url: "http://127.0.0.1:4173/health",
    env: { QRACER_PORT: "4173", QRACER_HOST: "127.0.0.1" },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
