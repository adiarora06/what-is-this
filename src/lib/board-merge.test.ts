import { describe, expect, it } from "vitest";
import { mergeBoards } from "@/lib/board-merge";
import type { ObjectCard, StoryboardBoard } from "@/lib/types";

function card(id: string, image = "local-image"): ObjectCard {
  return { id, createdAt: `2026-01-0${id === "local" ? 2 : 1}T00:00:00.000Z`, image, objectName: id, shortName: id, confidence: 0.8, category: "Test", about: "", visualClues: [], useCases: [], careTips: [], purchaseQuery: id, purchaseLinks: [], shoppingRecommended: false };
}

function board(id: string, items: ObjectCard[]): StoryboardBoard {
  return { id, name: id, createdAt: "2026-01-01T00:00:00.000Z", items };
}

describe("mergeBoards", () => {
  it("preserves local-only and cloud-only boards", () => {
    const merged = mergeBoards([board("local", [])], [board("cloud", [])]);
    expect(merged.map((item) => item.id)).toEqual(["local", "cloud"]);
  });

  it("merges items by stable id without dropping local-only data", () => {
    const merged = mergeBoards(
      [board("shared", [card("local"), card("same", "local-image")])],
      [board("shared", [card("cloud"), card("same", "cloud-image")])],
    );
    expect(merged[0].items.map((item) => item.id)).toEqual(["local", "same", "cloud"]);
    expect(merged[0].items.find((item) => item.id === "same")?.image).toBe("cloud-image");
  });

  it("keeps a local image when a signed cloud image is unavailable", () => {
    const merged = mergeBoards([board("shared", [card("same")])], [board("shared", [card("same", "")])]);
    expect(merged[0].items[0].image).toBe("local-image");
  });
});
