import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage, { metadata } from "@/app/privacy/page";

function pageText() {
  return renderToStaticMarkup(PrivacyPage())
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

describe("Chrome extension privacy policy", () => {
  it("has public-page metadata and the required effective date", () => {
    expect(metadata.title).toBe("Chrome Extension Privacy Policy | What Is This?");
    expect(metadata.description).toContain("What Is This? Guide Chrome extension");
    expect(pageText()).toContain("Last updated August 11, 2026");
  });

  it("is directly reachable from the declared product homepage", async () => {
    const homepageSource = await readFile(new URL("../page.tsx", import.meta.url), "utf8");
    expect(homepageSource).toContain('className="extensionPrivacyLink" href="/privacy"');
    expect(homepageSource).toContain("Extension privacy");
  });

  it("accurately describes the data boundary and on-device processing", () => {
    const text = pageText();

    expect(text).toContain("A screenshot of the visible area of the active tab");
    expect(text).toContain("Text you enter, such as a goal or clarification answer");
    expect(text).toContain("Chrome's built-in on-device LanguageModel API");
    expect(text).toContain("does not separately access page URLs, page titles, selected text, DOM content, form fields, cookies");
    expect(text).toContain("can therefore contain personal information, messages, usernames, security codes, financial details, or health information");
    expect(text).toContain("are not transmitted to What Is This? servers, Google, or another third party");
    expect(text).toContain("does not sell data, use data for advertising or credit decisions, or make extension data available for human review");
  });

  it("documents retention, permissions, Limited Use, and a public contact", () => {
    const markup = renderToStaticMarkup(PrivacyPage());
    const text = pageText();

    expect(text).toContain("chrome.storage.session");
    expect(text).toContain("writes no captures, typed context, guides, or settings to local or synchronized storage");
    expect(text).toContain("deletes that build's obsolete local processing-mode preference");
    for (const permission of ["activeTab", "sidePanel", "storage"]) {
      expect(text).toContain(permission);
    }
    expect(text).not.toContain("contextMenus");
    expect(text).toContain("Chrome Web Store User Data Policy, including the Limited Use requirements");
    expect(text).toContain("It is not transferred, sold, used for personalized advertising, or made available to people to read");
    expect(markup).toContain('href="https://github.com/adiarora06/what-is-this/issues"');
  });
});
