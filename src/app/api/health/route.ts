import { publicProviderError } from "@/lib/vision-policy";

export const runtime = "nodejs";
export const maxDuration = 10;

type GeminiHealth = { configured: boolean; valid: boolean; error?: string };
type BackendHealth = {
  configured: boolean;
  ok: boolean;
  error?: string;
  backend?: { mode?: string; yoloModel?: string; classifierModel?: string };
};

let geminiCache: { key: string; checkedAt: number; value: GeminiHealth } | null = null;
const GEMINI_CACHE_MS = 10 * 60_000;

async function checkGemini(): Promise<GeminiHealth> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { configured: false, valid: false };

  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
  const cacheKey = `${model}:${apiKey.length}:${apiKey.slice(-4)}`;
  if (geminiCache?.key === cacheKey && Date.now() - geminiCache.checkedAt < GEMINI_CACHE_MS) return geminiCache.value;

  let value: GeminiHealth;
  try {
    // Validate the configured key/model without spending generation tokens.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) {
      value = { configured: true, valid: true };
    } else {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      value = { configured: true, valid: false, error: publicProviderError("gemini", new Error(payload?.error?.message || String(response.status))) };
    }
  } catch (error) {
    value = { configured: true, valid: false, error: publicProviderError("gemini", error) };
  }

  geminiCache = { key: cacheKey, checkedAt: Date.now(), value };
  return value;
}

async function checkBackend(): Promise<BackendHealth> {
  const backendUrl = process.env.VISION_BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl) return { configured: false, ok: false };
  const backendToken = process.env.VISION_BACKEND_TOKEN?.trim();
  if (!backendToken || backendToken.length < 24) {
    return { configured: true, ok: false, error: "Classifier authentication needs a shared token of at least 24 characters." };
  }

  try {
    const response = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) return { configured: true, ok: false, error: `Classifier health check returned ${response.status}.` };

    const backend = (await response.json()) as {
      ok?: boolean;
      mode?: string;
      yolo_model?: string;
      classifier_model?: string;
    };
    if (!backend.ok) return { configured: true, ok: false, error: "Classifier reported that it is not ready." };
    return {
      configured: true,
      ok: true,
      backend: {
        mode: backend.mode,
        yoloModel: backend.yolo_model,
        classifierModel: backend.classifier_model,
      },
    };
  } catch (error) {
    return { configured: true, ok: false, error: publicProviderError("classifier", error) };
  }
}

export async function GET() {
  const accuracyProvider = (process.env.ACCURACY_PROVIDER || "auto").toLowerCase();
  const turnstileRequired =
    process.env.REQUIRE_TURNSTILE === "true" ||
    Boolean(process.env.TURNSTILE_SECRET_KEY?.trim() || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  const turnstileConfigured = Boolean(
    process.env.TURNSTILE_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  );
  const [gemini, classifier] = await Promise.all([checkGemini(), checkBackend()]);
  const geminiSelected = !["classifier", "cv"].includes(accuracyProvider);
  const openaiFallbackAvailable = Boolean(
    process.env.OPENAI_API_KEY?.trim() && process.env.ALLOW_OPENAI_FALLBACK === "true",
  );
  const availableProviders = [
    "auto",
    ...(gemini.valid ? ["gemini"] : []),
    ...(classifier.ok ? ["classifier"] : []),
    ...(openaiFallbackAvailable ? ["openai"] : []),
  ];
  const availableGuideProviders = [
    ...(gemini.valid ? ["gemini"] : []),
    ...(openaiFallbackAvailable ? ["openai"] : []),
  ];
  const providerOk = (geminiSelected && gemini.valid) || classifier.ok || openaiFallbackAvailable;
  const guideOk = availableGuideProviders.length > 0;
  const turnstileOk = !turnstileRequired || turnstileConfigured;
  const ok = (providerOk || guideOk) && turnstileOk;
  const errors = [
    gemini.configured && !gemini.valid ? gemini.error : undefined,
    classifier.configured && !classifier.ok ? classifier.error : undefined,
    !turnstileOk ? "Scan verification is not fully configured." : undefined,
  ].filter(Boolean);

  if (!ok) {
    console.warn(JSON.stringify({
      event: "vision.health.degraded",
      accuracyProvider,
      geminiConfigured: gemini.configured,
      geminiValid: gemini.valid,
      classifierConfigured: classifier.configured,
      classifierReady: classifier.ok,
      turnstileRequired,
      turnstileConfigured,
      errors,
    }));
  }

  return Response.json(
    {
      ok,
      status: providerOk && turnstileOk ? "cloud-ready" : guideOk && turnstileOk ? "guide-ready" : "private-ready",
      availableProviders,
      availableGuideProviders,
      error: ok ? undefined : "Cloud recognition is unavailable. On-device mode remains available.",
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
