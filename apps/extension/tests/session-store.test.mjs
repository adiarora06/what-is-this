import assert from "node:assert/strict";
import test from "node:test";
import {
  DeferredSessionSaveQueue,
  SESSION_KEY,
  beginCaptureSession,
  captureFailureSession,
  emptySession,
  isCurrentGeneration,
  loadSession,
  normalizeSession,
  recoverInterruptedGeneration,
  saveSession,
  sessionKeyForWindow,
} from "../session-store.js";

test("deferred session saves are cancelled or ordered before a capture boundary", async () => {
  const timers = new Map();
  let nextTimer = 1;
  const writes = [];
  let releaseFirstWrite;
  const firstWriteGate = new Promise((resolve) => {
    releaseFirstWrite = resolve;
  });
  const queue = new DeferredSessionSaveQueue(async (value) => {
    writes.push(value);
    if (value === "first") await firstWriteGate;
  }, {
    delay: 220,
    setTimer(callback) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  });
  const runNextTimer = () => {
    const next = timers.entries().next().value;
    assert.ok(next, "a deferred save timer should be queued");
    const [id, callback] = next;
    timers.delete(id);
    callback();
  };

  queue.schedule("discard-before-capture");
  await queue.cancelAndWait();
  assert.deepEqual(writes, []);

  queue.schedule("superseded-before-capture");
  await queue.flush("latest-before-capture");
  assert.deepEqual(writes, ["latest-before-capture"], "capture flushes the latest snapshot and cancels its older timer");

  queue.schedule("first");
  runNextTimer();
  await Promise.resolve();
  queue.schedule("second");
  runNextTimer();
  await Promise.resolve();
  assert.deepEqual(writes, ["latest-before-capture", "first"], "a newer save must wait for the in-flight write");

  const captureBoundary = queue.cancelAndWait();
  releaseFirstWrite();
  await captureBoundary;
  assert.deepEqual(writes, ["latest-before-capture", "first", "second"], "capture starts only after every started save settles");
});

test("clarification answers are session-only, bounded, and cleared by a fresh session", () => {
  const normalized = normalizeSession({
    clarificationAnswer: "a".repeat(700),
    clarificationError: "e".repeat(700),
    panelRevision: 7,
  });
  assert.equal(normalized.clarificationAnswer.length, 500);
  assert.equal(normalized.clarificationError.length, 500);
  assert.equal(normalized.panelRevision, 7);
  assert.equal(emptySession().clarificationAnswer, "");
  assert.equal(emptySession().clarificationError, null);
  assert.equal(normalizeSession({ clarificationAnswer: 123 }).clarificationAnswer, "");
  assert.equal(normalizeSession({ clarificationError: 123 }).clarificationError, null);
  assert.equal(normalizeSession({ panelRevision: -1 }).panelRevision, 0);
  assert.equal(normalizeSession({ panelRevision: "7" }).panelRevision, 0);
});

function usableSession(overrides = {}) {
  return normalizeSession({
    ...emptySession(),
    status: "complete",
    draft: {
      id: "draft-old",
      source: { kind: "visible-tab" },
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

test("an interrupted clarification update retains the question, answer, and prior request context", () => {
  const result = {
    subject: "Existing result",
    clarificationQuestion: "Which model number is visible?",
  };
  const recovered = recoverInterruptedGeneration(usableSession({
    status: "generating",
    generationId: "clarification-generation",
    clarificationAnswer: "Model A-100",
    result,
    responseWarnings: ["Keep the device disconnected."],
    requestId: "request-clarification",
  }));

  assert.equal(recovered.status, "error");
  assert.equal(recovered.generationId, null);
  assert.deepEqual(recovered.result, result);
  assert.equal(recovered.clarificationAnswer, "Model A-100");
  assert.deepEqual(recovered.responseWarnings, ["Keep the device disconnected."]);
  assert.equal(recovered.requestId, "request-clarification");
  assert.match(recovered.error, /answer was kept/i);
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
