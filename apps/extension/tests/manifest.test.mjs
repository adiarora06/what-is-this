import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest is MV3 with only the permissions used by the MVP", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.incognito, "not_allowed");
  assert.deepEqual(manifest.permissions, ["activeTab", "contextMenus", "sidePanel", "storage"]);
  assert.equal("optional_host_permissions" in manifest, false);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.equal(manifest.permissions.includes("aiLanguageModelOriginTrial"), false);
});

test("every manifest entry point is packaged locally", async () => {
  const packagedPaths = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const relativePath of new Set(packagedPaths)) {
    const file = new URL(`../${relativePath}`, import.meta.url);
    const contents = await readFile(file);
    assert.ok(contents.length > 0, `${relativePath} should not be empty`);
  }
  assert.ok(extensionRoot.endsWith("/apps/extension/"));
});

test("side panel loads no remote scripts or inline executable code", async () => {
  const html = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="sidepanel\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /<button id="center-crop-button"[^>]*type="button"[^>]*>Select center crop<\/button>/);
  assert.match(html, /id="capture-button"[^>]*disabled/);
  assert.match(html, /id="intent-select"[^>]*disabled/);
});
