import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-small", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } } },
    { name: "mobile-compact", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
    { name: "mobile-landscape", use: { ...devices["Pixel 7"], viewport: { width: 844, height: 390 } } },
    { name: "tablet-portrait", use: { ...devices["Desktop Chrome"], viewport: { width: 834, height: 1112 } } },
    { name: "tablet-landscape", use: { ...devices["Desktop Chrome"], viewport: { width: 1112, height: 834 } } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: process.env.E2E_PRODUCTION ? "npm run build && npm run start" : "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
