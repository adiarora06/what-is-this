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

async function identifyWithVisionBackend(parsed: z.infer<typeof requestSchema>) {
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
    card: {
      ...data,
      source: data.source || "cv-backend",
      safetyNote: data.safetyNote || undefined,
      purchaseLinks: data.purchaseLinks.length ? data.purchaseLinks : purchaseLinksFor(data.purchaseQuery),
    },
  };
}

async function identifyWithOpenAI(parsed: z.infer<typeof requestSchema>) {
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
    card: {
      ...data,
      source: data.source || "openai-fallback",
      safetyNote: data.safetyNote || undefined,
      purchaseLinks: data.purchaseLinks.length ? data.purchaseLinks : purchaseLinksFor(data.purchaseQuery),
    },
  };
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Send a valid data URL image." }, { status: 400 });
  }

  try {
    const backendResult = await identifyWithVisionBackend(parsed.data);
    if (backendResult) return Response.json(backendResult);

    if (!process.env.OPENAI_API_KEY || process.env.ALLOW_OPENAI_FALLBACK !== "true") {
      return Response.json(
        {
          ok: false,
          error:
            "VISION_BACKEND_URL is not configured. Start the CV model service and set VISION_BACKEND_URL, or set ALLOW_OPENAI_FALLBACK=true with OPENAI_API_KEY.",
        },
        { status: 500 },
      );
    }

    return Response.json(await identifyWithOpenAI(parsed.data));
  } catch (error) {
    if (process.env.ALLOW_OPENAI_FALLBACK === "true" && process.env.OPENAI_API_KEY && process.env.VISION_BACKEND_URL) {
      try {
        return Response.json(await identifyWithOpenAI(parsed.data));
      } catch {
        // Report the original backend error below.
      }
    }

    const message = error instanceof Error ? error.message : "The object could not be identified.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
