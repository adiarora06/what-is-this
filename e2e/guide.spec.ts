import { expect, test } from "@playwright/test";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n6sAAAAASUVORK5CYII=",
  "base64",
);

function guideResult(clarification: boolean) {
  return {
    subject: "Visible appliance control panel",
    intent: "explain",
    goal: "Understand the visible controls",
    summary: clarification
      ? "The exact model is needed before the controls can be explained reliably."
      : "The status control changes the appliance between standby and active operation.",
    confidence: clarification ? 0.2 : 0.72,
    evidence: clarification ? [] : [{ claim: "A status control is visible.", visibleSource: "Selected image" }],
    recommendedAction: clarification
      ? { title: "Find the model label", reason: "The label resolves the remaining ambiguity." }
      : { title: "Check the current status", reason: "The indicator confirms which mode is active." },
    steps: clarification ? [] : [{
      id: "check-status",
      title: "Check the indicator",
      instruction: "Read the indicator without opening the appliance.",
      completionCheck: "The current mode is visible.",
      risk: "Stop if the housing is damaged or wiring is exposed.",
    }],
    alternatives: [],
    warnings: ["Do not open the appliance to inspect the control."],
    ...(clarification ? { clarificationQuestion: "What model number is printed on the label?" } : {}),
    completionChecks: clarification ? [] : ["The active mode is confirmed."],
    sources: [],
    processing: { provider: "gemini", model: "test-guide" },
  };
}

test("guide modes enforce privacy and clear stale goals", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Guide me Get careful next steps." }).click();

  await expect(page.getByRole("heading", { name: "Get help from a photo" })).toBeVisible();
  await expect(page.getByText(/cannot call the cloud guide service/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use camera" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeDisabled();

  const goal = page.getByLabel(/What do you want to accomplish/);
  await goal.fill("Set up the device");
  await page.getByRole("button", { name: "Compare Weigh it against criteria." }).click();
  await expect(page.getByLabel(/What should this be compared with/)).toHaveValue("");

  await page.getByRole("button", { name: "Open Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Compare Weigh it against criteria." })).toHaveAttribute("aria-pressed", "true");
});

test("extension settings handoff sends no data and removes its query", async ({ page }) => {
  await page.goto("/?view=settings&source=extension");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(/did not send a screenshot or sign-in token/i)).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("classifier and classifier-only auto modes never send guide images", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One privacy-boundary check is sufficient");

  let guideRequests = 0;
  await page.route("**/api/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      availableProviders: ["auto", "classifier"],
      availableGuideProviders: [],
    }),
  }));
  await page.route("**/api/guide", (route) => {
    guideRequests += 1;
    return route.abort();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Explain Understand what it does." }).click();
  await page.getByRole("button", { name: "Open Settings" }).click();
  const provider = page.getByRole("combobox", { name: /Recognition mode/ });
  await provider.selectOption("classifier");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByText(/private classifier can identify objects but cannot produce guided answers/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use camera" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeDisabled();

  await page.getByRole("button", { name: "Open Settings" }).click();
  await provider.selectOption("auto");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByText(/cloud guide provider is not available/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeDisabled();
  expect(guideRequests).toBe(0);
});

test("a required guide goal reports and focuses the field before capture", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One validation-focus check is sufficient");

  await page.route("**/api/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      availableProviders: ["auto", "gemini"],
      availableGuideProviders: ["gemini"],
    }),
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Troubleshoot Work through a problem." }).click();
  await page.getByRole("button", { name: "Open Settings" }).click();
  await page.getByRole("combobox", { name: /Recognition mode/ }).selectOption("auto");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.getByRole("button", { name: "Upload photo" }).click();

  await expect(page.getByLabel(/What is going wrong/)).toBeFocused();
  await expect(page.getByText(/Describe the problem, comparison target, or outcome/)).toBeVisible();
});

test("guide clarification keeps warnings first and updates in place", async ({ page }, testInfo) => {
  test.skip(!["mobile-small", "desktop-chromium"].includes(testInfo.project.name), "Representative guide layouts only");

  const requestBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      availableProviders: ["auto", "gemini"],
      availableGuideProviders: ["gemini"],
    }),
  }));
  await page.route("**/api/guide", async (route) => {
    requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const clarification = requestBodies.length === 1;
    if (requestBodies.length === 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Guidance is temporarily unavailable.", requestId: "guide-request-error" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        provider: "gemini",
        model: "test-guide",
        requestId: clarification ? "guide-request-1" : "guide-request-3",
        warnings: ["Provider output was safety checked."],
        result: guideResult(clarification),
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Explain Understand what it does." }).click();
  await page.getByRole("button", { name: "Open Settings" }).click();
  await page.getByRole("combobox", { name: /Recognition mode/ }).selectOption("auto");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "guide.png", mimeType: "image/png", buffer: onePixelPng });

  await expect(page.getByRole("heading", { name: "Visible appliance control panel" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Before you continue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What model number is printed on the label?" })).toBeVisible();
  const warningBox = await page.locator(".guideWarnings").boundingBox();
  const clarificationBox = await page.locator(".clarificationPanel").boundingBox();
  expect(warningBox).not.toBeNull();
  expect(clarificationBox).not.toBeNull();
  expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(clarificationBox!.y);

  await page.getByLabel("Your answer").fill("Model A-100");
  await page.getByRole("button", { name: "Update the guide" }).click();
  await expect(page.getByLabel("Your answer")).toBeFocused();
  await expect(page.locator(".clarificationPanel .inlineError")).toContainText("Guided answers are temporarily unavailable");
  await page.getByRole("button", { name: "Update the guide" }).click();
  await expect(page.getByRole("heading", { name: "Visible appliance control panel" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();
  const stepText = await page.locator(".guideSteps li p").allTextContents();
  expect(stepText[0]).toMatch(/^Risk:/);
  expect(stepText[1]).toContain("Read the indicator");
  expect(requestBodies).toHaveLength(3);
  expect(requestBodies[0].image).toMatch(/^data:image\/(?:jpeg|png|webp);base64,/);
  expect(requestBodies[2].pageContext).toContain("User answer: Model A-100");
});

test("empty saved previews continue with metadata only and restore the identification", async ({ page }, testInfo) => {
  test.skip(!["mobile-small", "desktop-chromium"].includes(testInfo.project.name), "Representative saved-guide layouts only");

  const requestBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      availableProviders: ["auto", "gemini"],
      availableGuideProviders: ["gemini"],
    }),
  }));
  await page.route("**/api/guide", async (route) => {
    requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        provider: "gemini",
        model: "test-guide",
        requestId: "metadata-guide-request",
        warnings: [],
        result: { ...guideResult(false), subject: "Saved control panel", goal: "x".repeat(500) },
      }),
    });
  });

  await page.goto("/");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("what-is-this", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const createdAt = new Date().toISOString();
    const transaction = database.transaction("state", "readwrite");
    const store = transaction.objectStore("state");
    store.put([{
      id: "saved-board",
      name: "Saved tests",
      createdAt,
      items: [{
        id: "saved-card",
        createdAt,
        image: "",
        objectName: "Saved control panel",
        shortName: "Control panel",
        confidence: 0.88,
        category: "Appliance",
        about: "A confirmed appliance control panel.",
        visualClues: ["Status control"],
        useCases: ["Control an appliance"],
        careTips: ["Keep dry"],
        purchaseQuery: "Saved control panel",
        purchaseLinks: [],
        shoppingRecommended: false,
        verified: true,
        source: "cloud-sync",
      }],
    }], "boards");
    store.put([], "catalog");
    store.put([], "feedback");
    store.put({ saveFeedbackPhotos: false, textAssist: false, providerChoice: "auto" }, "preferences");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();

  await page.getByRole("button", { name: /Saved 1/ }).click();
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.getByRole("heading", { name: "Saved control panel" })).toBeVisible();
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to identification" })).toBeVisible();
  await expect(page.getByText("Confirmed details ready")).toBeVisible();
  await page.getByRole("button", { name: "Use confirmed details (no image sent)" }).click();

  await expect(page.getByRole("heading", { name: "Saved control panel" })).toBeFocused();
  expect(requestBodies).toHaveLength(1);
  expect(requestBodies[0]).not.toHaveProperty("image");
  expect(requestBodies[0].pageContext).toContain("Confirmed subject: Saved control panel");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.locator(".backButton").click();
  await expect(page.getByRole("heading", { name: "Saved control panel" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Confirmed", exact: true })).toBeVisible();
});
