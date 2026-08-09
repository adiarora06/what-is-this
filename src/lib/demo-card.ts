import type { ObjectCard } from "./types";

export const demoCard: ObjectCard = {
  id: "example-result",
  createdAt: "2026-01-01T00:00:00.000Z",
  image: "/icon-512.png",
  objectName: "What Is This? app icon",
  shortName: "App icon",
  confidence: 0.99,
  category: "Digital app icon",
  about: "This is the icon for What Is This?, the private-first visual identification app. An actual scan would describe the photographed subject and separate visible evidence from suggestions.",
  visualClues: ["A dark rounded square", "A pale circular lens shape", "A small green focus point"],
  useCases: ["Recognize the installed app", "Return to the scanner from a device home screen"],
  careTips: ["No physical care is needed for a digital icon"],
  purchaseQuery: "What Is This app",
  purchaseLinks: [],
  shoppingRecommended: false,
  verified: true,
  source: "Built-in example",
};
