import assert from "node:assert/strict";
import test from "node:test";
import { sourceForTab } from "../capture-source.js";
import { MAX_STORED_IMAGE_DATA_URL_LENGTH } from "../extension-policy.js";

test("capture sources retain no page address, title, or selection", () => {
  const source = sourceForTab({
    url: "https://example.com/private?token=secret",
    title: "Private page title",
    selection: "Private selection",
  });
  assert.deepEqual(source, { kind: "visible-tab" });
});

test("stored image cap leaves conservative headroom for three window-scoped full and cropped copies", () => {
  const sessionQuotaBytes = 10 * 1024 * 1024;
  const threeWindowsWithTwoUtf16Strings = MAX_STORED_IMAGE_DATA_URL_LENGTH * 3 * 2 * 2;
  assert.ok(threeWindowsWithTwoUtf16Strings < sessionQuotaBytes);
});
