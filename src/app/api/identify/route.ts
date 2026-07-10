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
  safetyNote: z.string().optional(),
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

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      {
        ok: false,
        error: "OPENAI_API_KEY is not configured. Add it in Vercel Project Settings > Environment Variables.",
      },
      { status: 500 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Send a valid data URL image." }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const prompt = [
    "Identify the single main object in this photo.",
    "Assume the user held one object in front of a phone camera for 2-5 seconds.",
    "Return JSON only with these keys: objectName, shortName, confidence, category, about, visualClues, useCases, careTips, purchaseQuery, safetyNote.",
    "objectName should be as specific as visual evidence allows. If a brand/model is visible, include it. If not, use the most likely generic product name.",
    "about should be a friendly 2-3 sentence 'about me' written as the object introducing itself.",
    "purchaseQuery should be a concise shopping/search query, not a URL.",
    "confidence is a number from 0 to 1.",
    parsed.data.context ? `User context: ${parsed.data.context}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const response = await getOpenAIClient().responses.create({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: parsed.data.image, detail: "high" },
          ],
        },
      ],
    });

    const raw = response.output_text || "{}";
    const data = resultSchema.parse(jsonFromText(raw));

    return Response.json({
      ok: true,
      model,
      card: {
        ...data,
        purchaseLinks: purchaseLinksFor(data.purchaseQuery),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The object could not be identified.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

