import { describe, expect, it } from "vitest";
import { friendlyCloudStatus, friendlyScanError } from "@/lib/public-error";

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
