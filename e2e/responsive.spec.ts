import { expect, test } from "@playwright/test";

test("layout reflows without horizontal overflow", async ({ page }) => {
  await page.goto("/");

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const width = viewport!.width;

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const [navigation, content, camera, controls] = await Promise.all([
    page.getByRole("navigation", { name: "Main navigation" }).boundingBox(),
    page.locator(".scanView").boundingBox(),
    page.locator(".cameraStage").boundingBox(),
    page.locator(".cameraSidebar").boundingBox(),
  ]);

  expect(navigation).not.toBeNull();
  expect(content).not.toBeNull();
  expect(camera).not.toBeNull();
  expect(controls).not.toBeNull();

  if (width >= 1024) {
    expect(navigation!.x + navigation!.width).toBeLessThan(content!.x);
    expect(camera!.x + camera!.width).toBeLessThan(controls!.x);
    expect(content!.width).toBeGreaterThan(700);
  } else if (width >= 768) {
    expect(camera!.x + camera!.width).toBeLessThan(controls!.x);
    expect(content!.width).toBeGreaterThan(700);
  } else {
    expect(controls!.y).toBeGreaterThanOrEqual(camera!.y + camera!.height);
  }
});

test("desktop settings use the available canvas", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "Desktop-only composition check");
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  const panels = page.locator(".settingsView > .settingsPanel");
  await expect(panels).toHaveCount(4);
  const [privacy, account, app, labs] = await Promise.all([
    panels.nth(0).boundingBox(),
    panels.nth(1).boundingBox(),
    panels.nth(2).boundingBox(),
    panels.nth(3).boundingBox(),
  ]);

  expect(privacy).not.toBeNull();
  expect(account).not.toBeNull();
  expect(app).not.toBeNull();
  expect(labs).not.toBeNull();
  expect(privacy!.x + privacy!.width).toBeLessThan(account!.x);
  expect(account!.x).toBe(app!.x);
  expect(app!.y).toBeGreaterThanOrEqual(account!.y + account!.height);
  expect(labs!.y).toBeGreaterThanOrEqual(Math.max(privacy!.y + privacy!.height, app!.y + app!.height));
});
