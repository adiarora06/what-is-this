import type { PurchaseLink } from "./types";

export function purchaseLinksFor(query: string): PurchaseLink[] {
  const cleanQuery = query.trim() || "object";
  const encoded = encodeURIComponent(cleanQuery);

  return [
    {
      label: "Google Shopping",
      url: `https://www.google.com/search?tbm=shop&q=${encoded}`,
    },
    {
      label: "Amazon",
      url: `https://www.amazon.com/s?k=${encoded}`,
    },
    {
      label: "eBay",
      url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
    },
  ];
}

