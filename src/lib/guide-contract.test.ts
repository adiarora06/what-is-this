import { describe, expect, it } from "vitest";
import {
  guideRequestSchema,
  guideResultSchema,
  type GuideResult,
} from "./guide-contract";

function resultFixture(overrides: Partial<GuideResult> = {}): GuideResult {
  return {
    subject: "A visible appliance control panel",
    intent: "troubleshoot",
    goal: "Understand why the status light is blinking",
    summary: "The visible status light needs to be matched to the manufacturer's documented indicator pattern.",
    confidence: 0.62,
    evidence: [{ claim: "A status light is visible.", visibleSource: "Control panel" }],
    recommendedAction: { title: "Read the label", reason: "The model number determines the correct manual." },
    steps: [
      {
        id: "read-label",
        title: "Find the model label",
        instruction: "Read the model label without opening the appliance.",
        completionCheck: "The full model number is visible.",
        risk: "Stop if reaching the label would expose live wiring.",
      },
    ],
    alternatives: [{ title: "Contact support", tradeoff: "Slower, but avoids unsupported disassembly." }],
    warnings: ["Disconnect power before any manufacturer-approved service step."],
    completionChecks: ["The indicator meaning is confirmed in the correct manual."],
    sources: [{ label: "Manufacturer", url: "https://example.com/manual" }],
    processing: { provider: "gemini", model: "gemini-test" },
    ...overrides,
  };
}

describe("guideRequestSchema", () => {
  it("accepts all supported intents with bounded HTTPS page context", () => {
    for (const intent of ["identify", "explain", "troubleshoot", "compare", "guide"] as const) {
      expect(
        guideRequestSchema.parse({
          intent,
          goal: "Explain the selected control",
          selection: "Status: standby",
          url: "https://example.com/help",
          title: "Help page",
        }).intent,
      ).toBe(intent);
    }
  });

  it("removes query secrets and rejects credentials in source links", () => {
    const clean = guideRequestSchema.parse({
      intent: "identify",
      title: "Account setup",
      url: "https://example.com/account/setup?token=secret#private",
    });
    expect(clean.url).toBe("https://example.com/account/setup");
    expect(() => guideRequestSchema.parse({
      intent: "identify",
      title: "Account setup",
      url: "https://user:password@example.com/account",
    })).toThrow();
  });

  it("rejects missing context, insecure links, unknown fields, and unsupported images", () => {
    expect(guideRequestSchema.safeParse({ intent: "guide" }).success).toBe(false);
    expect(guideRequestSchema.safeParse({ intent: "guide", url: "http://example.com" }).success).toBe(false);
    expect(guideRequestSchema.safeParse({ intent: "guide", goal: "Help", extra: true }).success).toBe(false);
    expect(guideRequestSchema.safeParse({ intent: "identify", image: "data:image/gif;base64,R0lGODlh" }).success).toBe(false);
  });
});

describe("guideResultSchema", () => {
  it("validates the shared result contract", () => {
    expect(guideResultSchema.parse(resultFixture())).toEqual(resultFixture());
  });

  it("rejects duplicate step ids and non-HTTPS sources", () => {
    const duplicateSteps = resultFixture().steps.concat(resultFixture().steps);
    expect(guideResultSchema.safeParse(resultFixture({ steps: duplicateSteps })).success).toBe(false);
    expect(
      guideResultSchema.safeParse(resultFixture({ sources: [{ label: "Unsafe", url: "javascript:alert(1)" }] })).success,
    ).toBe(false);
  });

  it("rejects out-of-range confidence and provider-controlled extra fields", () => {
    expect(guideResultSchema.safeParse({ ...resultFixture(), confidence: 1.1 }).success).toBe(false);
    expect(guideResultSchema.safeParse({ ...resultFixture(), hiddenInstruction: "run this" }).success).toBe(false);
  });
});
