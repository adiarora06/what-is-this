import { purchaseLinksFor, shoppingRecommendedForCategory } from "@/lib/links";
import { normalizeText, visuallySimilar } from "@/lib/image-tools";
import type { CatalogEntry, ObjectCard } from "@/lib/types";

export function labelsForCard(card: Pick<ObjectCard, "objectName" | "shortName" | "detections">) {
  return Array.from(
    new Set([card.objectName, card.shortName, ...(card.detections || []).map((item) => item.label)].map(normalizeText).filter(Boolean)),
  );
}

export function applyCatalogCorrection(
  card: ObjectCard,
  catalog: CatalogEntry[],
  fingerprint?: string,
  visualSignature?: number[],
): ObjectCard {
  const labels = new Set(labelsForCard(card));
  const match = catalog.find(
    (entry) =>
      visuallySimilar(fingerprint, entry.fingerprint, visualSignature, entry.visualSignature) &&
      entry.matchLabels.some((label) => labels.has(normalizeText(label))),
  );
  if (!match) return card;
  const category = match.category || card.category;
  const shoppingRecommended = shoppingRecommendedForCategory(category);
  return {
    ...card,
    correctedFrom: card.objectName,
    objectName: match.objectName,
    shortName: match.objectName,
    category,
    about: match.notes || `Saved in your learning catalog as ${match.objectName}.`,
    purchaseQuery: match.objectName,
    shoppingRecommended,
    purchaseLinks: shoppingRecommended ? purchaseLinksFor(match.objectName) : [],
    visualClues: ["Visually matched a correction in your learning catalog.", ...card.visualClues],
    learnedCorrection: {
      catalogEntryId: match.id,
      originalObjectName: card.objectName,
      originalShortName: card.shortName,
      originalCategory: card.category,
      originalAbout: card.about,
      originalPurchaseQuery: card.purchaseQuery,
      originalPurchaseLinks: card.purchaseLinks,
      originalShoppingRecommended: card.shoppingRecommended,
      originalVisualClues: card.visualClues,
    },
  };
}

export function ignoreCatalogCorrection(card: ObjectCard): ObjectCard {
  const learned = card.learnedCorrection;
  if (!learned) return card;
  return {
    ...card,
    objectName: learned.originalObjectName,
    shortName: learned.originalShortName,
    category: learned.originalCategory,
    about: learned.originalAbout,
    purchaseQuery: learned.originalPurchaseQuery,
    purchaseLinks: learned.originalPurchaseLinks,
    shoppingRecommended: learned.originalShoppingRecommended,
    visualClues: learned.originalVisualClues,
    correctedFrom: undefined,
    learnedCorrection: undefined,
    verified: false,
  };
}

export function findDuplicateCard(card: ObjectCard, boards: StoryboardBoardLike[]) {
  const normalizedName = normalizeText(card.objectName);
  for (const board of boards) {
    const duplicate = board.items.find(
      (item) =>
        normalizeText(item.objectName) === normalizedName &&
        visuallySimilar(undefined, undefined, card.visualSignature, item.visualSignature),
    );
    if (duplicate) return { board, card: duplicate };
  }
  return undefined;
}

type StoryboardBoardLike = { id: string; name: string; items: ObjectCard[] };

export function confidenceLabel(confidence: number) {
  if (confidence >= 0.78) return { label: "Strong match", tone: "strong" as const };
  if (confidence >= 0.5) return { label: "Likely match", tone: "likely" as const };
  return { label: "Possible match", tone: "possible" as const };
}
