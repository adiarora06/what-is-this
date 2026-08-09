import assert from "node:assert/strict";
import test from "node:test";
import { sourceForContextMenu, sourceForTab } from "../capture-source.js";
import {
  MAX_PAGE_URL_LENGTH,
  MAX_STORED_IMAGE_DATA_URL_LENGTH,
} from "../extension-policy.js";

test("capture sources cap and sanitize stored page URLs", () => {
  const source = sourceForTab({
    url: `https://example.com/${"a".repeat(3_000)}?token=secret#private`,
    title: "Example",
  });
  assert.equal(source.pageUrl.length, MAX_PAGE_URL_LENGTH);
  assert.equal(source.pageUrl.includes("token=secret"), false);
  assert.equal(source.pageUrl.includes("#private"), false);
});

test("image context-menu capture does not persist the image source URL", () => {
  const source = sourceForContextMenu({
    menuItemId: "guide-image",
    pageUrl: "https://example.com/gallery?private=yes",
    srcUrl: "https://cdn.example.com/signed.jpg?token=secret",
  }, { title: "Gallery" });
  assert.deepEqual(source, {
    kind: "image",
    pageUrl: "https://example.com/gallery",
    pageTitle: "Gallery",
    selection: "",
  });
  assert.equal("srcUrl" in source, false);
  assert.equal("imageUrl" in source, false);
});

test("stored image cap leaves conservative headroom for three window-scoped full and cropped copies", () => {
  const sessionQuotaBytes = 10 * 1024 * 1024;
  const threeWindowsWithTwoUtf16Strings = MAX_STORED_IMAGE_DATA_URL_LENGTH * 3 * 2 * 2;
  assert.ok(threeWindowsWithTwoUtf16Strings < sessionQuotaBytes);
});
