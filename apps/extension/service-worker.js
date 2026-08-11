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
  removeSessionForWindow,
  saveSession,
} from "./session-store.js";
import { WindowOperationRegistry } from "./window-operation-registry.js";

const MAX_STORED_JPEG_BYTES = Math.floor((MAX_STORED_IMAGE_DATA_URL_LENGTH - 64) * 3 / 4);
const LEGACY_SETTINGS_KEY = "whatIsThisGuideSettingsV1";
const captureOperations = new WindowOperationRegistry();

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

async function notifyPanel(windowId) {
  try {
    await chrome.runtime.sendMessage({ type: "GUIDE_SESSION_UPDATED", windowId });
  } catch {
    // The panel may not be open yet. It will read the session when it mounts.
  }
}

async function writeCaptureError(message, source, windowId, previous = emptySession(), expectedCaptureId = null) {
  if (expectedCaptureId) {
    if (!captureOperations.isCurrent(windowId, expectedCaptureId)) return false;
    const current = await loadSession(windowId);
    if (current.captureId !== expectedCaptureId) return false;
  }
  await saveSession(captureFailureSession(previous, {
    error: boundedText(message, 500),
    source,
    draftId: expectedCaptureId || crypto.randomUUID(),
  }), windowId);
  captureOperations.clear(windowId, expectedCaptureId);
  await notifyPanel(windowId);
  return true;
}

async function captureWindow(windowId, source) {
  if (!Number.isInteger(windowId)) {
    return { ok: false, error: "No active tab is available." };
  }
  const previous = await loadSession(windowId);

  const captureId = crypto.randomUUID();
  captureOperations.start(windowId, captureId);
  await saveSession(beginCaptureSession(previous, captureId), windowId);
  await notifyPanel(windowId);

  try {
    const rawDataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 80,
    });
    const image = await boundCapturedImage(rawDataUrl);
    const current = await loadSession(windowId);
    if (!captureOperations.isCurrent(windowId, captureId) || current.captureId !== captureId) return { ok: false, superseded: true };

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
    await saveSession(session, windowId);
    captureOperations.clear(windowId, captureId);
    await notifyPanel(windowId);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || "");
    const message = /quota|session storage|too large|reduced enough/i.test(detail)
      ? "This screenshot is too large to keep safely. The previous capture, if any, was retained."
      : /activeTab|permission|capture/i.test(detail)
        ? "Chrome needs a fresh tab gesture. Click the extension’s toolbar icon on this tab, then try Capture again."
        : "This tab cannot be captured. Protected Chrome pages and file pages may restrict screenshots.";
    const written = await writeCaptureError(message, source, windowId, previous, captureId);
    if (!written) return { ok: false, superseded: true };
    return { ok: false, error: message };
  }
}

async function captureActiveTab(windowId) {
  return captureWindow(windowId, sourceForTab());
}

async function configureAction() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("The side-panel action could not be configured.", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // v0.2 stored only a processing-mode preference. v0.3 has one fixed,
  // on-device mode and removes the obsolete local record during migration.
  void chrome.storage.local.remove(LEGACY_SETTINGS_KEY).catch(() => undefined);
  void configureAction();
});

chrome.runtime.onStartup.addListener(() => {
  void configureAction();
});

void configureAction();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.type !== "CAPTURE_ACTIVE_TAB" ||
    !Number.isInteger(message.windowId)
  ) return false;

  void captureActiveTab(message.windowId)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "The active tab could not be captured.",
    }));
  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  captureOperations.removeWindow(windowId);
  void removeSessionForWindow(windowId).catch(() => undefined);
});
