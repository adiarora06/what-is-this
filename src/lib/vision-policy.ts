export const MAX_IMAGE_BYTES = 3_000_000;
export const MAX_REQUEST_BYTES = 4_100_000;
export const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ServerVisionProvider = "gemini" | "classifier" | "openai";

export type ProviderAvailability = {
  gemini: boolean;
  classifier: boolean;
  openai: boolean;
  allowOpenAIFallback: boolean;
};

export function providerSequence(requested: string, availability: ProviderAvailability): ServerVisionProvider[] {
  if (requested === "gemini") return availability.gemini ? ["gemini"] : [];
  if (requested === "classifier") return availability.classifier ? ["classifier"] : [];
  if (requested === "openai") return availability.openai ? ["openai"] : [];

  const providers: ServerVisionProvider[] = [];
  if (availability.gemini) providers.push("gemini");
  if (availability.classifier) providers.push("classifier");
  if (availability.allowOpenAIFallback && availability.openai) providers.push("openai");
  return providers;
}

export function parseImageDataUrl(image: string) {
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("Image must be a base64 data URL.");

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }

  const data = match[2].replace(/[\r\n]/g, "");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((data.length * 3) / 4) - padding;
  if (byteLength <= 0 || byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Use an image under 3 MB.");
  }

  return { mimeType, data, byteLength };
}

export function publicProviderError(provider: ServerVisionProvider, error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (provider === "gemini") {
    if (message.includes("api key not valid") || message.includes("api_key_invalid")) return "Gemini API key is invalid.";
    if (message.includes("quota") || message.includes("429")) return "Gemini quota is temporarily unavailable.";
    if (message.includes("timed out") || message.includes("abort")) return "Gemini timed out.";
    return "Gemini vision is unavailable.";
  }
  if (provider === "classifier") {
    if (message.includes("timed out") || message.includes("abort")) return "The classifier timed out while waking up.";
    return "The classifier is unavailable.";
  }
  return "The OpenAI fallback is unavailable.";
}
