import { describe, expect, it } from "vitest";
import {
  buildWebGuideRequest,
  clarificationContext,
  guideGoalRequired,
  guideOperationKey,
  guideProviderAvailableForChoice,
  GuideGoalRequiredError,
  GuidePrivacyBoundaryError,
  isGuideImageDataUrl,
} from "./guide-client";
import type { ObjectCard } from "./types";

const image = "data:image/jpeg;base64,AA==";

describe("web guide privacy and request mapping", () => {
  it("distinguishes guide-capable providers from classifier-only recognition", () => {
    expect(guideProviderAvailableForChoice("auto", [])).toBe(false);
    expect(guideProviderAvailableForChoice("classifier", ["gemini"])).toBe(false);
    expect(guideProviderAvailableForChoice("gemini", ["openai"])).toBe(false);
    expect(guideProviderAvailableForChoice("auto", ["openai"])).toBe(true);
    expect(guideProviderAvailableForChoice("gemini", ["gemini"])).toBe(true);
  });

  it("blocks device and classifier modes before a request can be built", () => {
    for (const providerChoice of ["device", "classifier"] as const) {
      expect(() => buildWebGuideRequest({ intent: "explain", image, goal: "", providerChoice }))
        .toThrow(GuidePrivacyBoundaryError);
    }
  });

  it("requires goals only for actionable intents", () => {
    expect(guideGoalRequired("identify")).toBe(false);
    expect(guideGoalRequired("explain")).toBe(false);
    for (const intent of ["troubleshoot", "compare", "guide"] as const) {
      expect(() => buildWebGuideRequest({ intent, image, goal: "   ", providerChoice: "auto" }))
        .toThrow(GuideGoalRequiredError);
    }
  });

  it("maps only explicitly supported cloud choices and bounds text", () => {
    const request = buildWebGuideRequest({
      intent: "guide",
      image,
      goal: `  ${"x".repeat(700)}  `,
      pageContext: "  visible context  ",
      providerChoice: "gemini",
      turnstileToken: "token",
    });
    expect(request.provider).toBe("gemini");
    expect(request.goal).toHaveLength(500);
    expect(request.pageContext).toBe("visible context");
    expect(request.turnstileToken).toBe("token");
  });

  it("accepts only bounded guide image schemes and preserves clarification separately", () => {
    expect(isGuideImageDataUrl(image)).toBe(true);
    expect(isGuideImageDataUrl("https://storage.example/signed-image")).toBe(false);
    expect(clarificationContext(" Which model? ", " Model A ")).toContain("User answer: Model A");
  });
});

describe("guideOperationKey", () => {
  it("changes when a corrected subject, intent, goal, or image changes", () => {
    const card = { id: "card-1", objectName: "Original", correctedFrom: undefined } as ObjectCard;
    const base = guideOperationKey({ card, intent: "explain", goal: "Explain", image });
    expect(guideOperationKey({ card: { ...card, objectName: "Corrected", correctedFrom: "Original" }, intent: "explain", goal: "Explain", image })).not.toBe(base);
    expect(guideOperationKey({ card, intent: "guide", goal: "Explain", image })).not.toBe(base);
    expect(guideOperationKey({ card, intent: "explain", goal: "Another goal", image })).not.toBe(base);
    expect(guideOperationKey({ card, intent: "explain", goal: "Explain", image: `${image}AA` })).not.toBe(base);
  });
});
