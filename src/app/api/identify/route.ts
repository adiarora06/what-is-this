import OpenAI from "openai";
import { z } from "zod";
import { purchaseLinksFor } from "@/lib/links";

export const runtime = "nodejs";

const requestSchema = z.object({
  image: z.string().startsWith("data:image/"),
  context: z.string().max(500).optional(),
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
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

function imagePartsFromDataUrl(image: string) {
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Image must be a base64 data URL.");
  return { mimeType: match[1], data: match[2] };
}

function withPurchaseLinks(data: ResultPayload, source: string) {
  return {
    ...data,
    source: data.source || source,
    safetyNote: data.safetyNote || undefined,
    purchaseLinks: data.purchaseLinks.length ? data.purchaseLinks : purchaseLinksFor(data.purchaseQuery),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Identification failed.";
}

async function identifyWithVisionBackend(parsed: RequestPayload) {
  const backendUrl = process.env.VISION_BACKEND_URL?.replace(/\/$/, "");
  if (!backendUrl) return null;

  const response = await fetch(`${backendUrl}/identify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.VISION_BACKEND_TOKEN ? { Authorization: `Bearer ${process.env.VISION_BACKEND_TOKEN}` } : {}),
    },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision backend failed: ${text || response.statusText}`);
  }

  const payload = await response.json();
  const data = resultSchema.parse(payload.card);
  return {
    ok: true,
    model: payload.model || "cv-backend",
    card: withPurchaseLinks(data, "cv-backend"),
  };
}

async function identifyWithGemini(parsed: RequestPayload) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
  const image = imagePartsFromDataUrl(parsed.image);
  const prompt = [
    "Identify the single main object in this photo.",
    "Return JSON only with these keys: objectName, shortName, confidence, category, about, visualClues, useCases, careTips, purchaseQuery, safetyNote, alternatives.",
    "objectName should be the most specific name supported by visible evidence. Include brand/model only when it is visible or strongly indicated.",
    "If the exact product cannot be known, use the best plain-language object name and lower the confidence.",
    "Do not invent a brand, price, store, serial number, or medical/safety claim.",
    "confidence must be a number from 0 to 1.",
    "about should be a friendly 2-3 sentence 'about me' written as the object introducing itself.",
    "visualClues should cite visible evidence. useCases and careTips should be practical short strings.",
    "purchaseQuery should be a concise shopping/search query, not a URL.",
    parsed.context ? `User context: ${parsed.context}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inlineData: image }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini vision failed: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  const text = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text || "").join("").trim();
  if (!text) throw new Error(payload.error?.message || "Gemini returned no object description.");

  const data = resultSchema.parse(jsonFromText(text));
  return {
    ok: true,
    model,
    card: withPurchaseLinks(data, "gemini-vision"),
  };
}

async function identifyWithOpenAI(parsed: RequestPayload) {
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const prompt = [
    "Identify the single main object in this photo.",
    "Return JSON only with these keys: objectName, shortName, confidence, category, about, visualClues, useCases, careTips, purchaseQuery, safetyNote.",
    "objectName should be as specific as visual evidence allows.",
    "about should be a friendly 2-3 sentence 'about me' written as the object introducing itself.",
    "purchaseQuery should be a concise shopping/search query, not a URL.",
    parsed.context ? `User context: ${parsed.context}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await getOpenAIClient().responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: parsed.image, detail: "high" },
        ],
      },
    ],
  });

  const data = resultSchema.parse(jsonFromText(response.output_text || "{}"));
  return {
    ok: true,
    model,
    card: withPurchaseLinks(data, "openai-fallback"),
  };
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Send a valid data URL image." }, { status: 400 });
  }

  const provider = (process.env.ACCURACY_PROVIDER || "auto").toLowerCase();
  const errors: string[] = [];
  const shouldTryGemini = provider === "auto" || provider === "gemini" || provider === "gemini-only";
  const shouldTryClassifier = provider !== "gemini-only" && provider !== "openai";
  const shouldTryOpenAI = provider === "openai" || process.env.ALLOW_OPENAI_FALLBACK === "true";

  if (shouldTryGemini) {
    if (process.env.GEMINI_API_KEY) {
      try {
        return Response.json(await identifyWithGemini(parsed.data));
      } catch (error) {
        errors.push(errorMessage(error));
        if (provider === "gemini-only") {
          return Response.json({ ok: false, error: errors.join(" ") }, { status: 500 });
        }
      }
    } else if (provider === "gemini" || provider === "gemini-only") {
      errors.push("GEMINI_API_KEY is not configured.");
    }
  }

  if (shouldTryClassifier) {
    try {
      const backendResult = await identifyWithVisionBackend(parsed.data);
      if (backendResult) return Response.json(backendResult);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  if (shouldTryOpenAI) {
    if (process.env.OPENAI_API_KEY) {
      try {
        return Response.json(await identifyWithOpenAI(parsed.data));
      } catch (error) {
        errors.push(errorMessage(error));
      }
    } else if (provider === "openai") {
      errors.push("OPENAI_API_KEY is not configured.");
    }
  }

  const help =
    "Set GEMINI_API_KEY for high-accuracy vision, set VISION_BACKEND_URL for the lightweight classifier, or set ALLOW_OPENAI_FALLBACK=true with OPENAI_API_KEY.";
  return Response.json({ ok: false, error: errors.length ? `${errors.join(" ")} ${help}` : help }, { status: 500 });
}
