import { defineConfig, devices } from "@playwright/test";

// The smoke test needs a running stack: the API on :8100 and the frontend on :3100 (README, "Kontrollet"; CI starts both).
// PW_CHANNEL=chrome runs it in the Chrome that is already installed instead of Playwright's own download.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined } }],
});
