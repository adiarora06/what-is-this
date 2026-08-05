import { expect, test } from "@playwright/test";
import path from "node:path";

test("production can identify with the private on-device fallback", async ({ page }, testInfo) => {
  test.skip(!process.env.E2E_PRODUCTION, "Production CSP smoke test");
  test.skip(testInfo.project.name !== "mobile-chromium", "Run the model download once");
  test.setTimeout(180_000);

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path.resolve("public/icon-512.png"));

  await expect(page.locator("#result-heading")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText("Does this look right?")).toBeVisible();
  await expect(page.getByText(/WebAssembly|RuntimeError|no available backend/i)).toHaveCount(0);
});
