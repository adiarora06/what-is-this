import { sanitizePageUrl } from "./session-store.js";

export function boundedText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function sourceForContextMenu(info, tab) {
  const menuKind = {
    "guide-page": "page",
    "guide-selection": "selection",
    "guide-image": "image",
  }[info?.menuItemId];

  return {
    kind: menuKind || "page",
    pageUrl: sanitizePageUrl(info?.pageUrl || tab?.url),
    pageTitle: boundedText(tab?.title, 500),
    selection: boundedText(info?.selectionText, 2_000),
  };
}

export function sourceForTab(tab) {
  return {
    kind: "visible-tab",
    pageUrl: sanitizePageUrl(tab?.url),
    pageTitle: boundedText(tab?.title, 500),
    selection: "",
  };
}
