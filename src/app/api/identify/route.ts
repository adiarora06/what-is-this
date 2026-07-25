import OpenAI from "openai";
import { z } from "zod";
import { purchaseLinksFor, shoppingRecommendedForCategory } from "@/lib/links";
import {
  MAX_REQUEST_BYTES,
  parseImageDataUrl,
  providerSequence,
  publicProviderError,
  type ServerVisionProvider,
} from "@/lib/vision-policy";

export const runtime = "nodejs";
export const maxDuration = 30;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const requestSchema = z.object({
  image: z.string().max(MAX_REQUEST_BYTES).startsWith("data:image/"),
  context: z.string().max(500).optional(),
  provider: z.enum(["auto", "gemini", "classifier"]).optional(),
});

const resultSchema = z.object({
  objectName: z.string().min(1),
  shortName: z.string().min(1),
  confidence: z.number().min(0).max(1),
  category: z.string().min(1),
  about: z.string().min(1),
  visualClues: z.array(z.string()).default([]),
  useCases: z.array(z.string()).default([]),
  careTips: z.array(z.string()).default([]),
  purchaseQuery: z.string().min(1),
  purchaseLinks: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
  shoppingRecommended: z.boolean().optional(),
  safetyNote: z.string().nullish(),
  source: z.string().optional(),
  detections: z.array(z.object({ label: z.string(), confidence: z.number(), bbox: z.array(z.number()) })).default([]),
  alternatives: z
    .array(z.object({ label: z.string(), confidence: z.number(), source: z.string().optional() }))
    .default([]),
});

let openaiClient: OpenAI | null = null;

type RequestPayload = z.infer<typeof requestSchema>;
type ResultPayload = z.infer<typeof resultSchema>;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
  }
  return openaiClient;
}

function jsonFromText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

function withPurchaseLinks(data: ResultPayload, source: string) {
  const shoppingRecommended = data.shoppingRecommended ?? shoppingRecommendedForCategory(data.category);
  return {
    ...data,
    shoppingRecommended,
    source: data.source || source,
    safetyNote: data.safetyNote || undefined,
    purchaseLinks: shoppingRecommended
      ? data.purchaseLinks.length
        ? data.purchaseLinks
        : purchaseLinksFor(data.purchaseQuery)
      : [],
  };
}

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function takeRateLimit(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS } : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (rateBuckets.size > 2_000) {
    for (const [storedKey, entry] of rateBuckets) {
      if (entry.resetAt <= now) rateBuckets.delete(storedKey);
    }
  }

  return {
    allowed: bucket.count <= RATE_LIMIT_REQUESTS,
    remaining: Math.max(0, RATE_LIMIT_REQUESTS - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
  };
}

function responseHeaders(requestId: string, remaining: number, provider?: string) {
  return {
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    "X-RateLimit-Limit": String(RATE_LIMIT_REQUESTS),
    "X-RateLimit-Remaining": String(remaining),
    ...(provider ? { "X-Vision-Provider": provider } : {}),
  };
}

async function identifyWithVisionBackend(parsed: RequestPayload) {
  const backendUrl = process.env.VISION_BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl) throw new Error("VISION_BACKEND_URL is not configured.");

  const response = await fetch(`${backendUrl}/identify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.VISION_BACKEND_TOKEN ? { Authorization: `Bearer ${process.env.VISION_BACKEND_TOKEN}` } : {}),
    },
    body: JSON.stringify({ image: parsed.image, context: parsed.context }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`Vision backend returned ${response.status}.`);
  const payload = await response.json();
  const data = resultSchema.parse(payload.card);
  return { model: payload.model || "cv-backend", card: withPurchaseLinks(data, "cv-backend") };
}

async function identifyWithGemini(parsed: RequestPayload) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
  const image = parseImageDataUrl(parsed.image);
  const prompt = [
    "Identify the single main subject in this photo.",
    "Return JSON only with these keys: objectName, shortName, confidence, category, about, visualClues, useCases, careTips, purchaseQuery, shoppingRecommended, safetyNote, alternatives.",
    "objectName should be the most specific name supported by visible evidence. Include brand/model only when visible or strongly indicated.",
    "If the exact item cannot be known, use the best plain-language name and lower confidence. confidence must be from 0 to 1.",
    "Do not invent a brand, price, store, serial number, medical claim, or safety claim.",
    "about should be a factual, friendly 2-3 sentence introduction appropriate to the subject type.",
    "visualClues should cite visible evidence. useCases and careTips should be practical short strings.",
    "shoppingRecommended must be false for people, animals, plants, places, unidentified subjects, and anything unsafe or inappropriate to shop for.",
    "purchaseQuery should be a concise product search only when shoppingRecommended is true; otherwise use the object name.",
    parsed.context ? `User context: ${parsed.context}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
    throw new Error(payload?.error?.message || payload?.error?.status || `Gemini returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  const text = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text || "").join("").trim();
  if (!text) throw new Error(payload.error?.message || "Gemini returned no object description.");

  const data = resultSchema.parse(jsonFromText(text));
  return { model, card: withPurchaseLinks(data, "gemini-vision") };
}

async function identifyWithOpenAI(parsed: RequestPayload) {
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const prompt = [
    "Identify the single main subject in this photo.",
    "Return JSON only with these keys: objectName, shortName, confidence, category, about, visualClues, useCases, careTips, purchaseQuery, shoppingRecommended, safetyNote.",
    "Only set shoppingRecommended true for an ordinary consumer product. Never recommend shopping for people, animals, plants, or places.",
    parsed.context ? `User context: ${parsed.context}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await getOpenAIClient().responses.create({
    model,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: parsed.image, detail: "high" }] }],
  });
  const data = resultSchema.parse(jsonFromText(response.output_text || "{}"));
  return { model, card: withPurchaseLinks(data, "openai-fallback") };
}

async function runProvider(provider: ServerVisionProvider, parsed: RequestPayload) {
  if (provider === "gemini") return identifyWithGemini(parsed);
  if (provider === "classifier") return identifyWithVisionBackend(parsed);
  return identifyWithOpenAI(parsed);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const rateLimit = takeRateLimit(request);
  const baseHeaders = responseHeaders(requestId, rateLimit.remaining);
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Too many scans. Wait a moment and try again.", requestId },
      { status: 429, headers: { ...baseHeaders, "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ ok: false, error: "Image request is too large.", requestId }, { status: 413, headers: baseHeaders });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Send a JPEG, PNG, or WebP image under 3 MB.", requestId }, { status: 400, headers: baseHeaders });
  }

  try {
    parseImageDataUrl(parsed.data.image);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid image.", requestId },
      { status: 400, headers: baseHeaders },
    );
  }

  const configuredProvider = (parsed.data.provider || process.env.ACCURACY_PROVIDER || "auto").toLowerCase();
  const requestedProvider = configuredProvider === "cv" ? "classifier" : configuredProvider;
  const providers = providerSequence(requestedProvider, {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    classifier: Boolean(process.env.VISION_BACKEND_URL),
    openai: Boolean(process.env.OPENAI_API_KEY),
    allowOpenAIFallback: process.env.ALLOW_OPENAI_FALLBACK === "true",
  });

  if (!providers.length) {
    const error = requestedProvider === "gemini" ? "Gemini is not configured." : "No requested vision provider is configured.";
    return Response.json({ ok: false, error, requestId }, { status: 503, headers: baseHeaders });
  }

  const warnings: string[] = [];
  for (const provider of providers) {
    try {
      const result = await runProvider(provider, parsed.data);
      console.info(JSON.stringify({ event: "vision.identify.success", requestId, provider, model: result.model, durationMs: Date.now() - startedAt }));
      return Response.json(
        { ok: true, provider, model: result.model, card: result.card, warnings, requestId },
        { headers: responseHeaders(requestId, rateLimit.remaining, provider) },
      );
    } catch (error) {
      const publicError = publicProviderError(provider, error);
      warnings.push(publicError);
      console.warn(JSON.stringify({ event: "vision.identify.failure", requestId, provider, error: publicError, durationMs: Date.now() - startedAt }));
      if (requestedProvider !== "auto") {
        return Response.json({ ok: false, error: publicError, requestId }, { status: 502, headers: baseHeaders });
      }
    }
  }

  return Response.json(
    { ok: false, error: warnings.join(" ") || "No vision provider could identify this image.", requestId },
    { status: 502, headers: baseHeaders },
  );
}
