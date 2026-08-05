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
    const data = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64");
    expect(parseImageDataUrl(`data:image/jpeg;base64,${data}`)).toEqual({ mimeType: "image/jpeg", data, byteLength: 4 });
  });

  it("rejects unsupported and oversized images", () => {
    expect(() => parseImageDataUrl("data:image/gif;base64,R0lGODlh")).toThrow("JPEG, PNG, or WebP");
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_IMAGE_BYTES)]).toString("base64");
    expect(() => parseImageDataUrl(`data:image/jpeg;base64,${oversized}`)).toThrow("under 3 MB");
  });

  it("rejects a supported MIME type with mismatched content", () => {
    expect(() => parseImageDataUrl("data:image/jpeg;base64,iVBORw0KGgo=")).toThrow("does not match");
  });
});

describe("publicProviderError", () => {
  it("turns provider errors into safe actionable messages", () => {
    expect(publicProviderError("gemini", new Error("API key not valid"))).toBe("Gemini API key is invalid.");
    expect(publicProviderError("classifier", new Error("request timed out"))).toContain("timed out");
  });
});
