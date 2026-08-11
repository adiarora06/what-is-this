export const SESSION_KEY = "whatIsThisGuideSessionV1";
export const SESSION_KEY_PREFIX = `${SESSION_KEY}:window:`;

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
    this.setTimer = options.setTimer || globalThis.setTimeout;
    this.clearTimer = options.clearTimer || globalThis.clearTimeout;
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

export function sessionKeyForWindow(windowId) {
  if (!Number.isInteger(windowId) || windowId < 0) {
    throw new TypeError("A valid Chrome window id is required for guide session storage.");
  }
  return `${SESSION_KEY_PREFIX}${windowId}`;
}

export function emptySession() {
  return {
    version: 1,
    status: "idle",
    draft: null,
    intent: "identify",
    goal: "",
    clarificationAnswer: "",
    clarificationError: null,
    result: null,
    responseWarnings: [],
    requestId: null,
    captureId: null,
    generationId: null,
    panelRevision: 0,
    captureError: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function shortText(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export function normalizeSession(value) {
  const base = emptySession();
  if (!value || typeof value !== "object") return base;

  const allowedStatuses = new Set(["idle", "capturing", "ready", "generating", "complete", "error"]);
  const intent = GUIDE_INTENTS.includes(value.intent) ? value.intent : base.intent;
  const draft = value.draft && typeof value.draft === "object" ? value.draft : null;

  return {
    ...base,
    ...value,
    version: 1,
    status: allowedStatuses.has(value.status) ? value.status : base.status,
    intent,
    goal: shortText(value.goal, 500),
    clarificationAnswer: shortText(value.clarificationAnswer, 500),
    clarificationError: typeof value.clarificationError === "string"
      ? shortText(value.clarificationError, 500) || null
      : null,
    draft,
    responseWarnings: Array.isArray(value.responseWarnings)
      ? value.responseWarnings.filter((item) => typeof item === "string").slice(0, 8)
      : [],
    requestId: value.requestId ? shortText(value.requestId, 160) : null,
    captureId: value.captureId ? shortText(value.captureId, 160) : null,
    generationId: value.generationId ? shortText(value.generationId, 160) : null,
    panelRevision: Number.isSafeInteger(value.panelRevision) && value.panelRevision >= 0
      ? Math.min(value.panelRevision, Number.MAX_SAFE_INTEGER)
      : 0,
    captureError: value.captureError ? shortText(value.captureError, 500) : null,
    error: value.error ? shortText(value.error, 500) : null,
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
  const hasClarificationToResume = typeof current.result?.clarificationQuestion === "string"
    && Boolean(current.result.clarificationQuestion.trim());
  return normalizeSession({
    ...current,
    status: "error",
    result: hasClarificationToResume ? current.result : null,
    responseWarnings: hasClarificationToResume ? current.responseWarnings : [],
    requestId: hasClarificationToResume ? current.requestId : null,
    generationId: null,
    error: hasClarificationToResume
      ? "The clarification update was interrupted when the panel closed. Your answer was kept; try updating the guide again."
      : "The previous guide was interrupted when the panel closed. Try again.",
  });
}

export async function loadSession(windowId) {
  const key = sessionKeyForWindow(windowId);
  const stored = await chrome.storage.session.get([key, SESSION_KEY]);
  if (stored[key]) return normalizeSession(stored[key]);
  if (stored[SESSION_KEY]) {
    // The legacy record has no owning window. Discard it instead of exposing a
    // potentially sensitive capture in whichever window happens to load first.
    await chrome.storage.session.remove(SESSION_KEY);
  }
  return emptySession();
}

export async function saveSession(value, windowId) {
  const key = sessionKeyForWindow(windowId);
  const session = normalizeSession({ ...value, updatedAt: new Date().toISOString() });
  await chrome.storage.session.set({ [key]: session });
  return session;
}

export async function patchSession(patch, windowId) {
  const current = await loadSession(windowId);
  return saveSession({ ...current, ...patch }, windowId);
}

export async function resetSession(windowId) {
  const key = sessionKeyForWindow(windowId);
  const session = emptySession();
  await chrome.storage.session.set({ [key]: session });
  return session;
}

export async function removeSessionForWindow(windowId) {
  await chrome.storage.session.remove(sessionKeyForWindow(windowId));
}
