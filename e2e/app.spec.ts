import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("scan, saved, and settings navigation is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What is this?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();

  await page.getByRole("button", { name: /Saved/ }).click();
  await expect(page.getByRole("heading", { name: "Saved objects" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search saved objects" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("combobox", { name: /Recognition mode/ }).selectOption("device");
  await expect(page.getByText(/Images remain in this browser\./)).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("mobile controls meet minimum touch size", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only touch target check");
  await page.goto("/");
  const undersized = await page.locator("button:visible, a:visible, input:not([type=file]):visible, select:visible, summary:visible, label.backupPicker:visible").evaluateAll((elements) =>
    elements
      .map((element) => ({ label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ label, rect }) => ({ label, width: Math.round(rect.width), height: Math.round(rect.height) })),
  );
  expect(undersized).toEqual([]);
});

test("mobile primary actions are not covered by navigation", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only overlap check");
  await page.goto("/");
  const upload = page.getByRole("button", { name: "Upload photo" });
  await upload.scrollIntoViewIfNeeded();
  const [uploadBox, navigationBox] = await Promise.all([upload.boundingBox(), page.getByRole("navigation", { name: "Main navigation" }).boundingBox()]);
  expect(uploadBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(uploadBox!.y + uploadBox!.height).toBeLessThanOrEqual(navigationBox!.y);
});
