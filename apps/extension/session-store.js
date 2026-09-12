import { MAX_STORED_IMAGE_DATA_URL_LENGTH } from "./extension-policy.js";

export const LEGACY_SESSION_KEY = "whatIsThisGuideSessionV1";
export const SESSION_KEY = "whatIsThisGuideSessionV2";
export const SESSION_KEY_PREFIX = `${SESSION_KEY}:tab:`;

export const GUIDE_INTENTS = Object.freeze([
  "identify",
  "explain",
  "troubleshoot",
  "compare",
  "guide",
]);

export class DeferredSessionSaveQueue {
  constructor(write, options = {}) {
    if (typeof write !== "function") throw new TypeError("A session writer is required.");
    this.write = write;
    this.delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : 220;
    this.setTimer = options.setTimer || ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer = options.clearTimer || ((timer) => globalThis.clearTimeout(timer));
    this.onError = typeof options.onError === "function" ? options.onError : () => undefined;
    this.timer = null;
    this.pending = Promise.resolve();
  }

  schedule(value) {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.pending = this.pending
        .catch(() => undefined)
        .then(() => this.write(value))
        .catch((error) => {
          try {
            this.onError(error);
          } catch {
            // A status-rendering failure must not leave the queue rejected.
          }
        });
    }, this.delay);
  }

  async cancelAndWait() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    await this.pending.catch(() => undefined);
  }

  async flush(value) {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    await this.pending.catch(() => undefined);
    try {
      await this.write(value);
    } catch (error) {
      try {
        this.onError(error);
      } catch {
        // Preserve the storage failure as the error reported to the caller.
      }
      throw error;
    }
  }
}

export function sessionKeyForTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new TypeError("A valid Chrome tab id is required for guide session storage.");
  }
  return `${SESSION_KEY_PREFIX}${tabId}`;
}

export function emptySession() {
  return {
    version: 2,
    status: "idle",
    draft: null,
    intent: "identify",
    goal: "",
    clarificationAnswer: "",
    clarificationError: null,
    followUpQuestion: "",
    followUpError: null,
    completedStepIds: [],
    result: null,
    responseWarnings: [],
    requestId: null,
    captureId: null,
    generationId: null,
    generationMode: null,
    panelRevision: 0,
    captureError: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function shortText(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function storedImageDataUrl(value) {
  return typeof value === "string"
    && value.length <= MAX_STORED_IMAGE_DATA_URL_LENGTH
    && /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)
    ? value
    : null;
}

function normalizeDraft(value) {
  if (!value || typeof value !== "object") return null;
  const image = value.image && typeof value.image === "object" ? value.image : null;
  const dataUrl = storedImageDataUrl(image?.dataUrl);
  const originalDataUrl = storedImageDataUrl(image?.originalDataUrl);
  return {
    id: shortText(value.id, 160),
    createdAt: shortText(value.createdAt, 40),
    source: value.source?.kind === "visible-tab" ? { kind: "visible-tab" } : null,
    image: dataUrl ? {
      dataUrl,
      originalDataUrl,
      mimeType: ["image/jpeg", "image/png", "image/webp"].includes(image?.mimeType) ? image.mimeType : "image/jpeg",
      width: Number.isFinite(image?.width) && image.width > 0 ? Math.round(image.width) : null,
      height: Number.isFinite(image?.height) && image.height > 0 ? Math.round(image.height) : null,
    } : null,
  };
}

export function normalizeSession(value) {
  const base = emptySession();
  if (!value || typeof value !== "object") return base;

  const allowedStatuses = new Set(["idle", "capturing", "ready", "generating", "complete", "error"]);
  const intent = GUIDE_INTENTS.includes(value.intent) ? value.intent : base.intent;
  const draft = normalizeDraft(value.draft);

  return {
    ...base,
    version: 2,
    status: allowedStatuses.has(value.status) ? value.status : base.status,
    intent,
    goal: shortText(value.goal, 500),
    clarificationAnswer: shortText(value.clarificationAnswer, 500),
    clarificationError: typeof value.clarificationError === "string"
      ? shortText(value.clarificationError, 500) || null
      : null,
    followUpQuestion: shortText(value.followUpQuestion, 500),
    followUpError: typeof value.followUpError === "string"
      ? shortText(value.followUpError, 500) || null
      : null,
    completedStepIds: Array.isArray(value.completedStepIds)
      ? [...new Set(value.completedStepIds
        .filter((item) => typeof item === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item)))]
        .slice(0, 12)
      : [],
    draft,
    result: value.result && typeof value.result === "object" ? value.result : null,
    responseWarnings: Array.isArray(value.responseWarnings)
      ? value.responseWarnings.filter((item) => typeof item === "string").slice(0, 8)
      : [],
    requestId: value.requestId ? shortText(value.requestId, 160) : null,
    captureId: value.captureId ? shortText(value.captureId, 160) : null,
    generationId: value.generationId ? shortText(value.generationId, 160) : null,
    generationMode: ["initial", "retry", "clarification", "follow-up"].includes(value.generationMode)
      ? value.generationMode
      : null,
    panelRevision: Number.isSafeInteger(value.panelRevision) && value.panelRevision >= 0
      ? Math.min(value.panelRevision, Number.MAX_SAFE_INTEGER)
      : 0,
    captureError: value.captureError ? shortText(value.captureError, 500) : null,
    error: value.error ? shortText(value.error, 500) : null,
    updatedAt: typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
      ? shortText(value.updatedAt, 40)
      : base.updatedAt,
  };
}

export function beginCaptureSession(value, captureId) {
  const current = normalizeSession(value);
  const hasUsableCapture = Boolean(current.draft?.image?.dataUrl);
  return normalizeSession({
    ...(hasUsableCapture ? current : emptySession()),
    status: "capturing",
    captureId: shortText(captureId, 160) || null,
    generationId: null,
    generationMode: null,
    captureError: null,
    error: null,
  });
}

export function captureFailureSession(previousValue, { error, source, draftId }) {
  const previous = normalizeSession(previousValue);
  const message = shortText(error, 500) || "The visible tab could not be captured.";
  if (previous.draft?.image?.dataUrl) {
    return normalizeSession({
      ...previous,
      status: previous.result ? "complete" : "ready",
      captureId: null,
      generationId: null,
      generationMode: null,
      captureError: message,
      error: null,
    });
  }

  return normalizeSession({
    ...emptySession(),
    status: "error",
    draft: source ? { id: shortText(draftId, 160), source, image: null } : null,
    captureError: message,
    error: message,
    generationMode: null,
  });
}

export function isCurrentGeneration(value, { draftId, generationId }) {
  const current = normalizeSession(value);
  return Boolean(
    draftId &&
    generationId &&
    current.status === "generating" &&
    current.draft?.id === draftId &&
    current.generationId === generationId
  );
}

export function recoverInterruptedGeneration(value) {
  const current = normalizeSession(value);
  if (current.status !== "generating") return current;
  const canResumeFromPriorResult = Boolean(current.result)
    && ["clarification", "follow-up"].includes(current.generationMode);
  return normalizeSession({
    ...current,
    status: "error",
    result: canResumeFromPriorResult ? current.result : null,
    responseWarnings: canResumeFromPriorResult ? current.responseWarnings : [],
    requestId: canResumeFromPriorResult ? current.requestId : null,
    generationId: null,
    generationMode: null,
    error: canResumeFromPriorResult
      ? `The ${current.generationMode === "clarification" ? "clarification update" : "follow-up"} was interrupted when the panel closed. Your text was kept; try again.`
      : "The previous guide was interrupted when the panel closed. Try again.",
  });
}

export async function loadSession(tabId) {
  const key = sessionKeyForTab(tabId);
  const stored = await chrome.storage.session.get([key, SESSION_KEY, LEGACY_SESSION_KEY]);
  if (stored[key]) return normalizeSession(stored[key]);
  const obsoleteKeys = [SESSION_KEY, LEGACY_SESSION_KEY].filter((legacyKey) => stored[legacyKey]);
  if (obsoleteKeys.length) {
    // Legacy records have no owning tab. Discard them instead of exposing a
    // potentially sensitive capture in whichever tab happens to load first.
    await chrome.storage.session.remove(obsoleteKeys);
  }
  return emptySession();
}

export async function saveSession(value, tabId) {
  const key = sessionKeyForTab(tabId);
  const session = normalizeSession({ ...value, updatedAt: new Date().toISOString() });
  await chrome.storage.session.set({ [key]: session });
  return session;
}

export async function pruneTabSessions(keepTabId, maxSessions = 3) {
  const keepKey = sessionKeyForTab(keepTabId);
  const limit = Math.max(1, Math.min(6, Math.round(maxSessions) || 3));
  const stored = await chrome.storage.session.get(null);
  const sessions = Object.entries(stored)
    .filter(([key]) => key.startsWith(SESSION_KEY_PREFIX))
    .map(([key, value]) => ({
      key,
      updatedAt: Date.parse(value?.updatedAt || "") || 0,
      keep: key === keepKey,
    }))
    .sort((left, right) => Number(right.keep) - Number(left.keep) || right.updatedAt - left.updatedAt);
  const obsoleteKeys = sessions.slice(limit).map(({ key }) => key);
  if (obsoleteKeys.length) await chrome.storage.session.remove(obsoleteKeys);
  return obsoleteKeys;
}

export async function patchSession(patch, tabId) {
  const current = await loadSession(tabId);
  return saveSession({ ...current, ...patch }, tabId);
}

export async function resetSession(tabId) {
  const key = sessionKeyForTab(tabId);
  const session = emptySession();
  await chrome.storage.session.set({ [key]: session });
  return session;
}

export async function removeSessionForTab(tabId) {
  await chrome.storage.session.remove(sessionKeyForTab(tabId));
}
