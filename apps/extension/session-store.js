import { MAX_PAGE_URL_LENGTH } from "./extension-policy.js";

export const SESSION_KEY = "whatIsThisGuideSessionV1";
export const SESSION_KEY_PREFIX = `${SESSION_KEY}:window:`;
export const SETTINGS_KEY = "whatIsThisGuideSettingsV1";

export const GUIDE_INTENTS = Object.freeze([
  "identify",
  "explain",
  "troubleshoot",
  "compare",
  "guide",
]);

export const DEFAULT_SETTINGS = Object.freeze({
  adapter: "preview",
});

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
    result: null,
    responseWarnings: [],
    requestId: null,
    captureId: null,
    generationId: null,
    captureError: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function shortText(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export function sanitizePageUrl(value) {
  const bounded = shortText(typeof value === "string" ? value.trim() : "", MAX_PAGE_URL_LENGTH);
  if (!bounded) return "";

  try {
    const url = new URL(bounded);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, MAX_PAGE_URL_LENGTH);
  } catch {
    return "";
  }
}

export function normalizeSettings(value) {
  const adapter = value?.adapter;
  return {
    adapter: adapter === "browser-ai" ? adapter : "preview",
  };
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
    draft,
    responseWarnings: Array.isArray(value.responseWarnings)
      ? value.responseWarnings.filter((item) => typeof item === "string").slice(0, 8)
      : [],
    requestId: value.requestId ? shortText(value.requestId, 160) : null,
    captureId: value.captureId ? shortText(value.captureId, 160) : null,
    generationId: value.generationId ? shortText(value.generationId, 160) : null,
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
  return normalizeSession({
    ...current,
    status: "error",
    result: null,
    responseWarnings: [],
    requestId: null,
    generationId: null,
    error: "The previous guide was interrupted when the panel closed. Try again.",
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

export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(value) {
  const settings = normalizeSettings(value);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}
