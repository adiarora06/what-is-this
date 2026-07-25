import type { PurchaseLink } from "./types";

const SHOPPABLE_CATEGORIES = new Set([
  "bag",
  "book",
  "clothing",
  "electronics",
  "furniture",
  "kitchen",
  "sports",
  "tool",
  "toy",
  "vehicle accessory",
]);

export function shoppingRecommendedForCategory(category: string) {
  return SHOPPABLE_CATEGORIES.has(category.trim().toLowerCase());
}

export function purchaseLinksFor(query: string): PurchaseLink[] {
  const cleanQuery = query.trim() || "object";
  const encoded = encodeURIComponent(cleanQuery);

  return [
    { label: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${encoded}` },
    { label: "Amazon", url: `https://www.amazon.com/s?k=${encoded}` },
    { label: "Walmart", url: `https://www.walmart.com/search?q=${encoded}` },
    { label: "Target", url: `https://www.target.com/s?searchTerm=${encoded}` },
    { label: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}` },
  ];
}
