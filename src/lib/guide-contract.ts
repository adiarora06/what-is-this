import { z } from "zod";

export const GUIDE_INTENTS = ["identify", "explain", "troubleshoot", "compare", "guide"] as const;
export const GUIDE_PROVIDERS = ["auto", "gemini", "openai", "local"] as const;
export const GUIDE_EXECUTION_PROVIDERS = ["gemini", "openai", "local"] as const;

export const MAX_GUIDE_REQUEST_BYTES = 4_100_000;

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => requiredText(maximum).optional();
const httpsUrl = z.string().trim().max(2_048).transform((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe URL");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    context.addIssue({ code: "custom", message: "Only valid HTTPS links without credentials are allowed." });
    return z.NEVER;
  }
});

export const guideIntentSchema = z.enum(GUIDE_INTENTS);
export const guideProviderSchema = z.enum(GUIDE_PROVIDERS);
export const guideExecutionProviderSchema = z.enum(GUIDE_EXECUTION_PROVIDERS);

export const guideRequestSchema = z
  .object({
    intent: guideIntentSchema,
    image: z
      .string()
      .max(MAX_GUIDE_REQUEST_BYTES)
      .regex(/^data:image\/(?:jpeg|png|webp);base64,/i, "Use a JPEG, PNG, or WebP data URL.")
      .optional(),
    goal: optionalText(500),
    pageContext: optionalText(16_000),
    selection: optionalText(6_000),
    url: httpsUrl.optional(),
    title: optionalText(300),
    provider: guideProviderSchema.optional(),
    turnstileToken: optionalText(2_048),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.image && !value.goal && !value.pageContext && !value.selection && !value.url && !value.title) {
      context.addIssue({
        code: "custom",
        message: "Provide an image, goal, selection, or page context.",
        path: ["pageContext"],
      });
    }
  });

const evidenceSchema = z
  .object({
    claim: requiredText(500),
    visibleSource: optionalText(400),
  })
  .strict();

const recommendedActionSchema = z
  .object({
    title: requiredText(160),
    reason: requiredText(500),
  })
  .strict();

const guideStepSchema = z
  .object({
    id: requiredText(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use a stable alphanumeric step id."),
    title: requiredText(160),
    instruction: requiredText(1_000),
    completionCheck: optionalText(500),
    risk: optionalText(500),
  })
  .strict();

const alternativeSchema = z
  .object({
    title: requiredText(160),
    tradeoff: requiredText(500),
  })
  .strict();

const sourceSchema = z
  .object({
    label: requiredText(160),
    url: httpsUrl,
  })
  .strict();

const processingSchema = z
  .object({
    provider: guideExecutionProviderSchema,
    model: optionalText(120),
  })
  .strict();

const guideResultShape = {
  subject: requiredText(240),
  intent: guideIntentSchema,
  goal: requiredText(500),
  summary: requiredText(1_600),
  confidence: z.number().finite().min(0).max(1),
  evidence: z.array(evidenceSchema).max(8),
  recommendedAction: recommendedActionSchema,
  steps: z.array(guideStepSchema).max(12),
  alternatives: z.array(alternativeSchema).max(6),
  warnings: z.array(requiredText(700)).max(8),
  clarificationQuestion: optionalText(500),
  completionChecks: z.array(requiredText(500)).max(10),
  sources: z.array(sourceSchema).max(6),
};

function requireUniqueStepIds(
  value: { steps: Array<{ id: string }> },
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  value.steps.forEach((step, index) => {
    if (seen.has(step.id)) {
      context.addIssue({ code: "custom", message: "Step ids must be unique.", path: ["steps", index, "id"] });
    }
    seen.add(step.id);
  });
}

/** Provider-owned content. Processing metadata is added by the server after validation. */
export const guideContentSchema = z.object(guideResultShape).strict().superRefine(requireUniqueStepIds);

/** The shared, fully validated result returned by `/api/guide`. */
export const guideResultSchema = z
  .object({ ...guideResultShape, processing: processingSchema })
  .strict()
  .superRefine(requireUniqueStepIds);

export type GuideIntent = z.infer<typeof guideIntentSchema>;
export type GuideProvider = z.infer<typeof guideProviderSchema>;
export type GuideExecutionProvider = z.infer<typeof guideExecutionProviderSchema>;
export type GuideRequest = z.infer<typeof guideRequestSchema>;
export type GuideContent = z.infer<typeof guideContentSchema>;
export type GuideResult = z.infer<typeof guideResultSchema>;

export type GuideResponse =
  | {
      ok: true;
      result: GuideResult;
      provider: GuideExecutionProvider;
      model?: string;
      warnings?: string[];
      requestId: string;
    }
  | {
      ok: false;
      error: string;
      requestId: string;
    };
