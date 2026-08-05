import { describe, expect, it } from "vitest";
import { applyCatalogCorrection, confidenceLabel, findDuplicateCard, ignoreCatalogCorrection } from "@/lib/catalog-match";
import type { ObjectCard } from "@/lib/types";

function card(overrides: Partial<ObjectCard> = {}): ObjectCard {
  return {
    id: "one",
    createdAt: new Date(0).toISOString(),
    image: "",
    objectName: "Coffee mug",
    shortName: "Mug",
    confidence: 0.8,
    category: "Kitchen",
    about: "",
    visualClues: [],
    useCases: [],
    careTips: [],
    purchaseQuery: "Coffee mug",
    purchaseLinks: [],
    shoppingRecommended: false,
    visualSignature: Array.from({ length: 64 }, () => 0.125),
    ...overrides,
  };
}

describe("catalog matching", () => {
  it("gives confidence a plain-language label", () => {
    expect(confidenceLabel(0.9).label).toBe("Strong match");
    expect(confidenceLabel(0.6).label).toBe("Likely match");
    expect(confidenceLabel(0.2).label).toBe("Possible match");
  });

  it("finds a visually matching saved duplicate with the same name", () => {
    const existing = card();
    const duplicate = card({ id: "two" });
    const match = findDuplicateCard(duplicate, [{ id: "board", name: "Saved", items: [existing] }]);
    expect(match?.card.id).toBe("one");
  });

  it("does not merge a different object name", () => {
    const existing = card();
    const different = card({ id: "two", objectName: "Water bottle" });
    expect(findDuplicateCard(different, [{ id: "board", name: "Saved", items: [existing] }])).toBeUndefined();
  });

  it("explains and can undo a learned correction", () => {
    const original = card({ objectName: "Street sign", shortName: "Street sign" });
    const corrected = applyCatalogCorrection(original, [{ id: "learned", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), objectName: "App icon", category: "Digital asset", notes: "", matchLabels: ["street sign"], visualSignature: original.visualSignature }], undefined, original.visualSignature);
    expect(corrected.learnedCorrection?.catalogEntryId).toBe("learned");
    expect(ignoreCatalogCorrection(corrected).objectName).toBe("Street sign");
  });

  it("does not reuse a correction for a merely similar grayscale signature", () => {
    const signature = Array.from({ length: 64 }, () => 0.125);
    const rawShifted = Array.from({ length: 64 }, (_, index) => index < 8 ? 0.18 : 0.112);
    const magnitude = Math.hypot(...rawShifted);
    const shifted = rawShifted.map((value) => value / magnitude);
    const original = card({ objectName: "Street sign", shortName: "Street sign", visualSignature: signature });
    const corrected = applyCatalogCorrection(original, [{ id: "learned", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), objectName: "App icon", category: "Digital asset", notes: "", matchLabels: ["street sign"], visualSignature: shifted }], undefined, signature);
    expect(corrected.learnedCorrection).toBeUndefined();
  });
});
