import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, parseImageDataUrl, providerSequence, publicProviderError } from "./vision-policy";

const allProviders = { gemini: true, classifier: true, openai: true, allowOpenAIFallback: true };

describe("providerSequence", () => {
  it("keeps explicit providers strict", () => {
    expect(providerSequence("gemini", allProviders)).toEqual(["gemini"]);
    expect(providerSequence("classifier", allProviders)).toEqual(["classifier"]);
  });

  it("uses ordered fallbacks only for auto", () => {
    expect(providerSequence("auto", allProviders)).toEqual(["gemini", "classifier", "openai"]);
  });
});

describe("parseImageDataUrl", () => {
  it("accepts supported images and reports decoded bytes", () => {
    expect(parseImageDataUrl("data:image/jpeg;base64,YWJj")).toEqual({ mimeType: "image/jpeg", data: "YWJj", byteLength: 3 });
  });

  it("rejects unsupported and oversized images", () => {
    expect(() => parseImageDataUrl("data:image/gif;base64,YWJj")).toThrow("JPEG, PNG, or WebP");
    const oversized = "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 1) * 4) / 3));
    expect(() => parseImageDataUrl(`data:image/jpeg;base64,${oversized}`)).toThrow("under 3 MB");
  });
});

describe("publicProviderError", () => {
  it("turns provider errors into safe actionable messages", () => {
    expect(publicProviderError("gemini", new Error("API key not valid"))).toBe("Gemini API key is invalid.");
    expect(publicProviderError("classifier", new Error("request timed out"))).toContain("timed out");
  });
});
