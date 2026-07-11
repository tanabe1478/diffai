import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4321", viewport: { width: 1280, height: 720 }, trace: "retain-on-failure" },
  webServer: {
    command: "node tests/start-test-server.mjs",
    url: "http://127.0.0.1:4321",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
