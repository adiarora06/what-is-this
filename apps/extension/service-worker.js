import { boundedText, sourceForTab } from "./capture-source.js";
import {
  MAX_STORED_IMAGE_DATA_URL_LENGTH,
  MAX_STORED_IMAGE_DIMENSION,
} from "./extension-policy.js";
import {
  beginCaptureSession,
  captureFailureSession,
  emptySession,
  loadSession,
  pruneTabSessions,
  removeSessionForTab,
  saveSession,
} from "./session-store.js";
import { OperationRegistry } from "./operation-registry.js";

const MAX_STORED_JPEG_BYTES = Math.floor((MAX_STORED_IMAGE_DATA_URL_LENGTH - 64) * 3 / 4);
const LEGACY_SETTINGS_KEY = "whatIsThisGuideSettingsV1";
const ACTIVE_TAB_KEY_PREFIX = "whatIsThisGuideActiveTabV1:window:";
const captureOperations = new OperationRegistry();
const activeTabsByWindow = new Map();

function activeTabKey(windowId) {
  return `${ACTIVE_TAB_KEY_PREFIX}${windowId}`;
}

async function setActiveTabContext({ tabId, windowId, captureGranted = false }) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) return null;
  const previous = activeTabsByWindow.get(windowId);
  if (Number.isInteger(previous?.tabId) && previous.tabId !== tabId) {
    captureOperations.remove(previous.tabId);
  }
  const context = { tabId, windowId, captureGranted: Boolean(captureGranted), updatedAt: new Date().toISOString() };
  activeTabsByWindow.set(windowId, context);
  await chrome.storage.session.set({ [activeTabKey(windowId)]: context });
  return context;
}

async function getActiveTabContext(windowId) {
  if (!Number.isInteger(windowId)) return null;
  if (activeTabsByWindow.has(windowId)) return activeTabsByWindow.get(windowId);
  const key = activeTabKey(windowId);
  const stored = await chrome.storage.session.get(key);
  const context = stored[key];
  if (!Number.isInteger(context?.tabId) || context.windowId !== windowId) return null;
  activeTabsByWindow.set(windowId, context);
  return context;
}

function bytesToBase64(bytes) {
  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

async function jpegDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

async function boundCapturedImage(dataUrl) {
  if (dataUrl.length <= MAX_STORED_IMAGE_DATA_URL_LENGTH) {
    return { dataUrl, width: null, height: null };
  }
  if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") {
    throw new Error("The screenshot is too large for session storage on this device.");
  }

  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const initialScale = Math.min(
      1,
      MAX_STORED_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));

    for (let sizeAttempt = 0; sizeAttempt < 6; sizeAttempt += 1) {
      const output = new OffscreenCanvas(width, height);
      output.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.8, 0.7, 0.6, 0.5]) {
        const blob = await output.convertToBlob({ type: "image/jpeg", quality });
        if (blob.size <= MAX_STORED_JPEG_BYTES) {
          return { dataUrl: await jpegDataUrl(blob), width, height };
        }
      }
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
  } finally {
    bitmap.close();
  }

  throw new Error("The screenshot could not be reduced enough for session storage.");
}

async function notifyPanel(windowId, tabId, captureGranted = false) {
  try {
    await chrome.runtime.sendMessage({ type: "GUIDE_SESSION_UPDATED", windowId, tabId, captureGranted });
  } catch {
    // The panel may not be open yet. It will read the session when it mounts.
  }
}

async function writeCaptureError(message, source, tabId, windowId, previous = emptySession(), expectedCaptureId = null, captureGranted = true) {
  if (expectedCaptureId) {
    if (!captureOperations.isCurrent(tabId, expectedCaptureId)) return false;
    const current = await loadSession(tabId);
    if (current.captureId !== expectedCaptureId) return false;
  }
  await saveSession(captureFailureSession(previous, {
    error: boundedText(message, 500),
    source,
    draftId: expectedCaptureId || crypto.randomUUID(),
  }), tabId);
  captureOperations.clear(tabId, expectedCaptureId);
  await notifyPanel(windowId, tabId, captureGranted);
  return true;
}

async function captureTab(tabId, windowId, source) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return { ok: false, error: "No active tab is available." };
  }
  const activeContext = await getActiveTabContext(windowId);
  if (activeContext?.tabId !== tabId) {
    return { ok: false, error: "The active tab changed. Use Capture again on the tab you want to guide." };
  }
  if (!activeContext.captureGranted) {
    return { ok: false, error: "Click the extension’s toolbar icon on this tab before capturing it." };
  }
  const previous = await loadSession(tabId);

  const captureId = crypto.randomUUID();
  captureOperations.start(tabId, captureId);
  await saveSession(beginCaptureSession(previous, captureId), tabId);
  await notifyPanel(windowId, tabId, true);

  try {
    const rawDataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 80,
    });
    const image = await boundCapturedImage(rawDataUrl);
    // Reserve the session budget only after Chrome produced a usable capture.
    await pruneTabSessions(tabId, 3);
    const currentContext = await getActiveTabContext(windowId);
    const current = await loadSession(tabId);
    if (currentContext?.tabId !== tabId || !captureOperations.isCurrent(tabId, captureId) || current.captureId !== captureId) {
      return { ok: false, superseded: true };
    }

    const session = {
      ...emptySession(),
      status: "ready",
      intent: "identify",
      draft: {
        id: captureId,
        createdAt: new Date().toISOString(),
        source,
        image: {
          dataUrl: image.dataUrl,
          originalDataUrl: null,
          mimeType: "image/jpeg",
          width: image.width,
          height: image.height,
        },
      },
    };
    await saveSession(session, tabId);
    await pruneTabSessions(tabId, 3);
    captureOperations.clear(tabId, captureId);
    await notifyPanel(windowId, tabId, true);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || "");
    const lostCaptureGrant = /activeTab|permission|fresh tab gesture|must be invoked/i.test(detail);
    const message = /quota|session storage|too large|reduced enough/i.test(detail)
      ? "This screenshot is too large to keep safely. The previous capture, if any, was retained."
      : lostCaptureGrant
        ? "Chrome needs a fresh tab gesture. Click the extension’s toolbar icon on this tab, then try Capture again."
        : "This tab cannot be captured. Protected Chrome pages and file pages may restrict screenshots.";
    if (lostCaptureGrant) {
      await setActiveTabContext({ tabId, windowId, captureGranted: false }).catch(() => undefined);
    }
    const written = await writeCaptureError(message, source, tabId, windowId, previous, captureId, !lostCaptureGrant);
    if (!written) return { ok: false, superseded: true };
    return { ok: false, error: message };
  }
}

async function captureActiveTab(tabId, windowId) {
  return captureTab(tabId, windowId, sourceForTab());
}

async function configureAction() {
  try {
    // Keep action clicks observable so the worker can bind the global panel to
    // the tab that granted activeTab before opening it.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    console.warn("The side-panel action could not be configured.", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // v0.2 stored only a processing-mode preference. v0.3 and later have one fixed,
  // on-device mode and removes the obsolete local record during migration.
  void chrome.storage.local.remove(LEGACY_SETTINGS_KEY).catch(() => undefined);
  void configureAction();
});

chrome.runtime.onStartup.addListener(() => {
  void configureAction();
});

void configureAction();

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) return;
  // Open synchronously from the action gesture; session bookkeeping may finish
  // afterward without consuming Chrome's transient activation.
  const openPanel = chrome.sidePanel.open({ windowId: tab.windowId });
  void openPanel.catch(() => undefined);
  void setActiveTabContext({ tabId: tab.id, windowId: tab.windowId, captureGranted: true })
    .then(() => notifyPanel(tab.windowId, tab.id, true))
    .catch(() => undefined);
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  captureOperations.remove(tabId);
  void setActiveTabContext({ tabId, windowId, captureGranted: false })
    .then(() => notifyPanel(windowId, tabId))
    .catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo?.status !== "loading" || !Number.isInteger(tab?.windowId)) return;
  void getActiveTabContext(tab.windowId)
    .then((activeContext) => activeContext?.tabId === tabId && activeContext.captureGranted
      ? setActiveTabContext({ tabId, windowId: tab.windowId, captureGranted: false })
      : null)
    .then((updated) => updated ? notifyPanel(tab.windowId, tabId, false) : undefined)
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !["CAPTURE_ACTIVE_TAB", "GET_ACTIVE_TAB_CONTEXT"].includes(message?.type) ||
    !Number.isInteger(message.windowId)
  ) return false;

  const operation = message.type === "GET_ACTIVE_TAB_CONTEXT"
    ? getActiveTabContext(message.windowId).then((context) => ({ ok: Boolean(context), context }))
    : Number.isInteger(message.tabId)
      ? captureActiveTab(message.tabId, message.windowId)
      : Promise.resolve({ ok: false, error: "No active tab is available." });
  void operation
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "The active tab could not be captured.",
    }));
  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  activeTabsByWindow.delete(windowId);
  void chrome.storage.session.remove(activeTabKey(windowId)).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  captureOperations.remove(tabId);
  void removeSessionForTab(tabId).catch(() => undefined);
});
