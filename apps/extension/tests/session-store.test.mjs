import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_KEY,
  beginCaptureSession,
  captureFailureSession,
  emptySession,
  isCurrentGeneration,
  loadSession,
  normalizeSettings,
  normalizeSession,
  recoverInterruptedGeneration,
  sanitizePageUrl,
  saveSession,
  sessionKeyForWindow,
} from "../session-store.js";

test("disabled cloud settings migrate back to private preview", () => {
  assert.deepEqual(normalizeSettings({ adapter: "cloud-api" }), { adapter: "preview" });
  assert.deepEqual(normalizeSettings({ adapter: "browser-ai" }), { adapter: "browser-ai" });
});

test("captured page URLs do not retain queries, fragments, or credentials", () => {
  assert.equal(
    sanitizePageUrl("https://example.com/account/setup?token=secret#private"),
    "https://example.com/account/setup",
  );
  assert.equal(sanitizePageUrl("https://user:password@example.com/account"), "");
  assert.equal(sanitizePageUrl("chrome://settings/privacy"), "");
  assert.equal(sanitizePageUrl("not a url"), "");
  assert.equal(sanitizePageUrl(`https://example.com/${"a".repeat(3_000)}`).length, 2_048);
});

function usableSession(overrides = {}) {
  return normalizeSession({
    ...emptySession(),
    status: "complete",
    draft: {
      id: "draft-old",
      source: { kind: "visible-tab", pageUrl: "https://example.com/" },
      image: { dataUrl: "data:image/jpeg;base64,AA==", originalDataUrl: null },
    },
    result: { subject: "Existing result" },
    requestId: "request-old",
    ...overrides,
  });
}

test("capture attempts retain the usable draft and restore it after failure", () => {
  const previous = usableSession();
  const capturing = beginCaptureSession(previous, "capture-next");
  assert.equal(capturing.status, "capturing");
  assert.equal(capturing.captureId, "capture-next");
  assert.equal(capturing.draft.id, "draft-old");
  assert.equal(capturing.result.subject, "Existing result");

  const restored = captureFailureSession(previous, {
    error: "Protected tab",
    source: { kind: "visible-tab" },
    draftId: "capture-next",
  });
  assert.equal(restored.status, "complete");
  assert.equal(restored.draft.id, "draft-old");
  assert.equal(restored.result.subject, "Existing result");
  assert.equal(restored.requestId, "request-old");
  assert.equal(restored.captureError, "Protected tab");
  assert.equal(restored.captureId, null);
});

test("capture failure without a prior image keeps an actionable error draft", () => {
  const failed = captureFailureSession(emptySession(), {
    error: "No active tab",
    source: { kind: "visible-tab" },
    draftId: "capture-failed",
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.draft.id, "capture-failed");
  assert.equal(failed.captureError, "No active tab");
});

test("guide operations match both their draft and generation id", () => {
  const generating = usableSession({ status: "generating", generationId: "generation-a", result: null });
  assert.equal(isCurrentGeneration(generating, { draftId: "draft-old", generationId: "generation-a" }), true);
  assert.equal(isCurrentGeneration(generating, { draftId: "draft-new", generationId: "generation-a" }), false);
  assert.equal(isCurrentGeneration(generating, { draftId: "draft-old", generationId: "generation-b" }), false);
  assert.equal(isCurrentGeneration({ ...generating, status: "ready" }, { draftId: "draft-old", generationId: "generation-a" }), false);
});

test("a panel reload recovers an abandoned guide generation", () => {
  const generating = usableSession({
    status: "generating",
    generationId: "generation-abandoned",
    result: null,
  });
  const recovered = recoverInterruptedGeneration(generating);
  assert.equal(recovered.status, "error");
  assert.equal(recovered.generationId, null);
  assert.equal(recovered.result, null);
  assert.match(recovered.error, /interrupted/i);
  assert.equal(recoverInterruptedGeneration(usableSession()).status, "complete");
});

test("session storage is isolated per Chrome window and ignores the legacy global record", async (context) => {
  const previousChrome = globalThis.chrome;
  const records = { [SESSION_KEY]: usableSession({ goal: "Legacy private capture" }) };
  globalThis.chrome = {
    storage: {
      session: {
        async get(keys) {
          const result = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (Object.hasOwn(records, key)) result[key] = records[key];
          }
          return result;
        },
        async set(values) {
          Object.assign(records, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key];
        },
      },
    },
  };
  context.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });

  const legacyIgnored = await loadSession(11);
  assert.equal(legacyIgnored.status, "idle");
  assert.equal(SESSION_KEY in records, false);

  await saveSession(usableSession({ goal: "Window eleven" }), 11);
  await saveSession(usableSession({ goal: "Window twelve" }), 12);
  assert.equal((await loadSession(11)).goal, "Window eleven");
  assert.equal((await loadSession(12)).goal, "Window twelve");
  assert.notEqual(sessionKeyForWindow(11), sessionKeyForWindow(12));
  assert.throws(() => sessionKeyForWindow(undefined), /window id/i);
});
