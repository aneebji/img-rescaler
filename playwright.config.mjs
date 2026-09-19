import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
