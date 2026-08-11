import { describe, expect, it } from "vitest";
import { GuidePrivacyBoundaryError, GuideRequestError } from "@/lib/guide-client";
import { friendlyCloudStatus, friendlyGuideError, friendlyScanError, guideErrorReference } from "@/lib/public-error";

describe("friendlyScanError", () => {
  it("does not expose a WebAssembly runtime exception", () => {
    const internal = "RuntimeError: WebAssembly.instantiate violates Content Security Policy at stack.js:123";
    const message = friendlyScanError(new Error(internal));
    expect(message).toBe("Private recognition could not start. Retry, or open Settings and choose another available mode.");
    expect(message).not.toContain("stack.js");
  });

  it("preserves safe file guidance", () => {
    expect(friendlyScanError(new Error("Choose a JPEG, PNG, or WebP image."))).toBe("Choose a JPEG, PNG, or WebP image.");
  });

  it("maps unknown failures to a recoverable message", () => {
    expect(friendlyScanError(new Error("secret provider payload"))).toContain("No recognition provider");
  });
});

describe("friendlyCloudStatus", () => {
  it("never exposes provider configuration details", () => {
    const message = friendlyCloudStatus("Classifier authentication needs a shared token of at least 24 characters.");
    expect(message).toBe("Cloud recognition is unavailable. On-device mode remains available.");
    expect(message).not.toMatch(/classifier|token|authentication|24/i);
  });
});

describe("friendlyGuideError", () => {
  it("preserves the local privacy boundary and a safe request reference", () => {
    expect(friendlyGuideError(new GuidePrivacyBoundaryError("device"))).toMatch(/has not left this browser/i);
    const error = new GuideRequestError("internal provider payload", "request-123");
    expect(friendlyGuideError(error)).toBe("The guide could not be created. Try again or return to identification.");
    expect(guideErrorReference(error)).toBe("request-123");
  });

  it("does not expose provider or credential details", () => {
    const message = friendlyGuideError(new Error("Gemini API key authentication failed at provider endpoint"));
    expect(message).toBe("The guide could not be created. Try again or return to identification.");
    expect(message).not.toMatch(/gemini|api key|authentication|provider/i);
  });
});
