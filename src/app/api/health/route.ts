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
const GEMINI_CACHE_MS = 5 * 60_000;

async function checkGemini(): Promise<GeminiHealth> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { configured: false, valid: false };

  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
  const cacheKey = `${model}:${apiKey.length}:${apiKey.slice(-4)}`;
  if (geminiCache?.key === cacheKey && Date.now() - geminiCache.checkedAt < GEMINI_CACHE_MS) return geminiCache.value;

  let value: GeminiHealth;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "vision health check" }] }] }),
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

  try {
    const response = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
      headers: process.env.VISION_BACKEND_TOKEN ? { Authorization: `Bearer ${process.env.VISION_BACKEND_TOKEN}` } : undefined,
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) return { configured: true, ok: false, error: `Classifier health check returned ${response.status}.` };

    const backend = await response.json();
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
  const [gemini, classifier] = await Promise.all([checkGemini(), checkBackend()]);
  const geminiSelected = !["classifier", "cv"].includes(accuracyProvider);
  const availableProviders = [
    "auto",
    ...(gemini.valid ? ["gemini"] : []),
    ...(classifier.configured ? ["classifier"] : []),
  ];
  const ok = (geminiSelected && gemini.valid) || classifier.ok;
  const errors = [gemini.configured && !gemini.valid ? gemini.error : undefined, classifier.configured && !classifier.ok ? classifier.error : undefined].filter(Boolean);

  return Response.json(
    {
      ok,
      accuracyProvider,
      geminiConfigured: gemini.configured,
      geminiValid: gemini.valid,
      geminiError: gemini.error,
      availableProviders,
      backendConfigured: classifier.configured,
      backendError: classifier.error,
      backend: classifier.backend,
      error: ok ? undefined : errors.join(" ") || "No vision provider is available.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
