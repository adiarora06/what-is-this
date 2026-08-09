import type { GuideIntent, GuideProvider, GuideRequest } from "./guide-contract";
import type { IdentificationProvider, ObjectCard } from "./types";

export type GuideRemoteProvider = "gemini" | "openai";

export const GUIDE_INTENT_DETAILS: Record<GuideIntent, {
  label: string;
  description: string;
  goalLabel: string;
  goalHelp: string;
  action: string;
}> = {
  identify: {
    label: "Identify",
    description: "Name what is visible.",
    goalLabel: "Optional clue",
    goalHelp: "Add where you found it or what it connects to.",
    action: "Identify image",
  },
  explain: {
    label: "Explain",
    description: "Understand what it does.",
    goalLabel: "What should the explanation focus on?",
    goalHelp: "Optional: name the part or detail you want explained.",
    action: "Explain image",
  },
  troubleshoot: {
    label: "Troubleshoot",
    description: "Work through a problem.",
    goalLabel: "What is going wrong?",
    goalHelp: "Required: describe the symptom, message, or unexpected behavior.",
    action: "Troubleshoot image",
  },
  compare: {
    label: "Compare",
    description: "Weigh it against criteria.",
    goalLabel: "What should this be compared with?",
    goalHelp: "Required: describe the other option or criteria. This version does not compare a second photo.",
    action: "Compare image",
  },
  guide: {
    label: "Guide me",
    description: "Get careful next steps.",
    goalLabel: "What do you want to accomplish?",
    goalHelp: "Required: describe the outcome you want.",
    action: "Create guide",
  },
};

const GOAL_REQUIRED = new Set<GuideIntent>(["troubleshoot", "compare", "guide"]);
const GUIDE_IMAGE_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,/i;

export class GuidePrivacyBoundaryError extends Error {
  constructor(public readonly reason: "device" | "classifier") {
    super(reason === "device"
      ? "Guided answers are off in on-device mode. The image has not left this browser."
      : "The private classifier cannot create guided answers. The image has not been sent elsewhere.");
    this.name = "GuidePrivacyBoundaryError";
  }
}

export class GuideGoalRequiredError extends Error {
  constructor() {
    super("Describe the problem, comparison target, or outcome before continuing.");
    this.name = "GuideGoalRequiredError";
  }
}

export class GuideRequestError extends Error {
  constructor(message: string, public readonly requestId?: string) {
    super(message);
    this.name = "GuideRequestError";
  }
}

export function guideGoalRequired(intent: GuideIntent) {
  return GOAL_REQUIRED.has(intent);
}

export function isGuideImageDataUrl(value: string | undefined | null): value is string {
  return Boolean(value && GUIDE_IMAGE_PATTERN.test(value));
}

export function guideProviderForChoice(choice: IdentificationProvider): GuideProvider {
  if (choice === "device") throw new GuidePrivacyBoundaryError("device");
  if (choice === "classifier") throw new GuidePrivacyBoundaryError("classifier");
  return choice === "gemini" ? "gemini" : "auto";
}

export function guideProviderAvailableForChoice(
  choice: IdentificationProvider,
  availableProviders: GuideRemoteProvider[] | null,
) {
  if (!availableProviders || choice === "device" || choice === "classifier") return false;
  if (choice === "gemini") return availableProviders.includes("gemini");
  return availableProviders.length > 0;
}

export function buildWebGuideRequest(input: {
  intent: Exclude<GuideIntent, "identify">;
  image?: string;
  goal: string;
  pageContext?: string;
  title?: string;
  providerChoice: IdentificationProvider;
  turnstileToken?: string | null;
}): GuideRequest {
  const goal = input.goal.replace(/\s+/g, " ").trim().slice(0, 500);
  if (guideGoalRequired(input.intent) && !goal) throw new GuideGoalRequiredError();
  const provider = guideProviderForChoice(input.providerChoice);
  const pageContext = input.pageContext?.replace(/\s+/g, " ").trim().slice(0, 16_000);
  const title = input.title?.replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    intent: input.intent,
    ...(input.image && isGuideImageDataUrl(input.image) ? { image: input.image } : {}),
    ...(goal ? { goal } : {}),
    ...(pageContext ? { pageContext } : {}),
    ...(title ? { title } : {}),
    provider,
    ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}),
  };
}

export function guideContextForCard(card: ObjectCard) {
  return [
    `Confirmed subject: ${card.objectName}.`,
    card.category ? `Category: ${card.category}.` : "",
    card.about,
    card.visualClues.length ? `Visible clues: ${card.visualClues.join("; ")}.` : "",
  ].filter(Boolean).join(" ").slice(0, 4_000);
}

export function clarificationContext(question: string, answer: string) {
  const cleanQuestion = question.replace(/\s+/g, " ").trim().slice(0, 500);
  const cleanAnswer = answer.replace(/\s+/g, " ").trim().slice(0, 500);
  return `Clarification requested: ${cleanQuestion}\nUser answer: ${cleanAnswer}`.slice(0, 1_100);
}

export function guideOperationKey(input: {
  card?: ObjectCard | null;
  intent: GuideIntent;
  goal: string;
  image?: string;
}) {
  const imageMarker = input.image ? `${input.image.slice(0, 48)}:${input.image.length}` : "metadata-only";
  return [
    input.card?.id || "new-capture",
    input.card?.objectName || "unconfirmed-subject",
    input.card?.correctedFrom || "",
    input.intent,
    input.goal.trim(),
    imageMarker,
  ].join("|");
}
