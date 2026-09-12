import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest is MV3 with only the permissions used by the on-device release", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.4.0");
  assert.equal(manifest.minimum_chrome_version, "148");
  assert.equal(manifest.homepage_url, "https://what-is-this-mobile.vercel.app/");
  assert.equal(manifest.incognito, "not_allowed");
  assert.deepEqual(manifest.permissions, ["activeTab", "sidePanel", "storage"]);
  assert.equal("host_permissions" in manifest, false);
  assert.equal("optional_host_permissions" in manifest, false);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.deepEqual(manifest.commands._execute_action.suggested_key, {
    default: "Ctrl+Shift+Y",
    mac: "Command+Shift+Y",
  });
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.equal(manifest.permissions.includes("contextMenus"), false);
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
  const javascript = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const serviceWorker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="sidepanel\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /data-crop-preset="center">Center<\/button>/);
  assert.match(html, /data-crop-preset="top">Top<\/button>/);
  assert.match(html, /data-crop-preset="bottom">Bottom<\/button>/);
  assert.match(html, /id="preview-canvas" tabindex="0"/);
  assert.match(html, /id="capture-button"[^>]*disabled>Capture visible tab privately<\/button>/);
  assert.match(html, /id="intent-select"[^>]*disabled/);
  assert.match(html, /id="capture-disclosure-heading">One visible screenshot, processed on this device<\/strong>/);
  assert.match(html, /passwords, codes, health or financial details, and private messages/);
  assert.match(html, /not sent to us, the page, or another provider/);
  assert.match(html, /https:\/\/what-is-this-mobile\.vercel\.app\/privacy/);
  assert.match(html, /id="browser-ai-status">Checking Chrome and this device\.<\/span>/);
  assert.doesNotMatch(html, /Private preview|cloud-api|coming later|MVP/i);
  assert.match(html, /id="clarification-form"[^>]*class="clarification-form"/);
  assert.match(html, /id="clarification-input"[\s\S]*maxlength="500"[\s\S]*required/);
  assert.match(html, /aria-describedby="clarification-text clarification-help clarification-count clarification-error"/);
  assert.match(html, /id="clarification-submit"[^>]*type="submit"[^>]*disabled>Update guide<\/button>/);
  assert.match(html, /id="cancel-generation-button"[^>]*type="button"[^>]*hidden disabled>Cancel guide<\/button>/);
  assert.match(html, /id="follow-up-input"[\s\S]*maxlength="500"[\s\S]*required/);
  assert.match(html, /id="copy-guide-button"[^>]*>Copy guide<\/button>/);
  assert.match(html, /id="retry-guide-button"[^>]*>Retry<\/button>/);
  assert.match(html, /id="recapture-button"[^>]*>Recapture<\/button>/);
  assert.match(html, /class="prompt-chip"/);
  assert.match(html, /id="step-progress"/);
  assert.doesNotMatch(javascript, /chrome\.permissions\.request/);
  assert.doesNotMatch(javascript, /fetch\(|TRUSTED_BACKEND|cloud-api|deterministic-preview/);
  assert.doesNotMatch(serviceWorker, /chrome\.contextMenus/);
  assert.doesNotMatch(serviceWorker, /chrome\.tabs\.query/);
  assert.match(serviceWorker, /chrome\.tabs\.captureVisibleTab\(windowId,/);
  assert.doesNotMatch(serviceWorker, /captureVisibleTab\(tab\.windowId/);
  assert.match(serviceWorker, /chrome\.storage\.local\.remove\(LEGACY_SETTINGS_KEY\)/);
  assert.match(javascript, /elements\["clarification-form"\]\.addEventListener\("submit"/);
  assert.match(javascript, /elements\["recommendation-section"\]\.hidden = Boolean\(clarification\)/);
  assert.match(javascript, /activeGenerationController\.abort\(\)/);
  assert.match(javascript, /elements\["generate-button"\]\.focus\(\)/);
  assert.match(javascript, /await sessionSaveQueue\.flush\(\{ value: session, tabId: currentTabId \}\);\s+const response = await chrome\.runtime\.sendMessage/);
  assert.match(javascript, /const browserResponse = runBrowserGuide\(request, \{[\s\S]*?await pendingSessionSave;[\s\S]*?saveSession\(generatingSession/);
  assert.match(javascript, /activeGenerationOperation && !isCurrentGeneration\(incoming, activeGenerationOperation\)/);
  assert.match(javascript, /incoming\.panelRevision < session\.panelRevision/);
  assert.match(javascript, /chrome\.runtime\.onMessage\.addListener[\s\S]*switchToTab\(message\.tabId, \{ captureGranted: message\.captureGranted \}\)[\s\S]*loadSession\(currentTabId\)/);
  assert.match(javascript, /elements\["intent-select"\]\.addEventListener\("change"[\s\S]*result: null[\s\S]*render\(\);\s+queueSessionSave\(\);/);
  assert.match(javascript, /elements\["goal-input"\]\.addEventListener\("input"[\s\S]*result: null[\s\S]*render\(\);\s+queueSessionSave\(\);/);
  assert.match(javascript, /elements\["follow-up-form"\]\.addEventListener\("submit"/);
  assert.match(javascript, /followUpContext\(startingSession\.result, followUpQuestion\)/);
  assert.match(javascript, /elements\["steps-list"\]\.addEventListener\("change"/);
  assert.match(javascript, /navigator\.clipboard\.writeText\(formatGuide\(session\.result\)\)/);
  assert.match(serviceWorker, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(serviceWorker, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(serviceWorker, /captureGranted: false/);
  assert.match(serviceWorker, /removeSessionForTab\(tabId\)/);
});
