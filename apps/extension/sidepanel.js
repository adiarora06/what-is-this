import {
  DeferredSessionSaveQueue,
  isCurrentGeneration,
  loadSession,
  normalizeSession,
  recoverInterruptedGeneration,
  resetSession,
  saveSession,
  sessionKeyForWindow,
} from "./session-store.js";
import { MAX_STORED_IMAGE_DATA_URL_LENGTH } from "./extension-policy.js";
import {
  GuideAdapterError,
  buildGuideRequest,
  clarificationContext,
  detectLanguageModel,
  runBrowserGuide,
} from "./guide-adapter.js";

const elements = Object.fromEntries([
  "privacy-pill", "reset-button", "capture-empty", "preview-region", "preview-canvas",
  "preview-loading", "center-crop-button", "apply-crop-button", "restore-image-button", "source-summary",
  "capture-button", "capture-status", "intent-select", "goal-label", "goal-input",
  "goal-help", "goal-count", "browser-ai-status", "data-boundary", "generate-button", "cancel-generation-button", "generate-status",
  "result-panel", "confidence-badge", "result-heading", "result-goal", "result-summary",
  "warnings-section", "warnings-list", "clarification-section", "clarification-text",
  "clarification-form", "clarification-input", "clarification-count", "clarification-error",
  "clarification-submit", "recommendation-section", "recommendation-heading", "recommendation-reason",
  "evidence-section", "evidence-list",
  "steps-section", "steps-list", "checks-section", "checks-list", "alternatives-section",
  "alternatives-list", "sources-section", "sources-list", "processing-line",
].map((id) => [id, document.getElementById(id)]));

const canvas = elements["preview-canvas"];
const context = canvas.getContext("2d");
const goalRequired = new Set(["troubleshoot", "compare", "guide"]);

let session = normalizeSession();
let modelCapability = { supported: false, availability: "checking" };
let previewImage = null;
let previewUrl = "";
let cropRect = null;
let cropStart = null;
let currentWindowId = null;
let sessionStorageKey = null;
let activeGenerationController = null;
let activeGenerationOperation = null;
let panelCapturePending = false;

const sessionSaveQueue = new DeferredSessionSaveQueue(
  ({ value, windowId }) => saveSession(value, windowId),
  {
    onError() {
      setStatus(elements["generate-status"], "The session could not be saved.", true);
    },
  },
);

function setStatus(element, message, isError = false) {
  element.textContent = message || "";
  element.classList.toggle("error", isError);
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function drawPreview() {
  if (!previewImage) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
  if (!cropRect || cropRect.width < 2 || cropRect.height < 2) return;

  context.save();
  context.fillStyle = "rgba(10, 15, 12, 0.58)";
  context.fillRect(0, 0, canvas.width, cropRect.y);
  context.fillRect(0, cropRect.y, cropRect.x, cropRect.height);
  context.fillRect(cropRect.x + cropRect.width, cropRect.y, canvas.width - cropRect.x - cropRect.width, cropRect.height);
  context.fillRect(0, cropRect.y + cropRect.height, canvas.width, canvas.height - cropRect.y - cropRect.height);
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(2, Math.round(canvas.width / 500));
  context.setLineDash([10, 7]);
  context.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  context.restore();
}

function loadPreview(dataUrl) {
  if (!dataUrl || dataUrl === previewUrl) return;
  previewUrl = dataUrl;
  previewImage = null;
  cropRect = null;
  elements["apply-crop-button"].disabled = true;
  elements["preview-loading"].hidden = false;
  const image = new Image();
  image.onload = () => {
    if (previewUrl !== dataUrl) return;
    previewImage = image;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    elements["preview-loading"].hidden = true;
    drawPreview();
  };
  image.onerror = () => {
    if (previewUrl !== dataUrl) return;
    elements["preview-loading"].textContent = "The preview could not be decoded.";
  };
  image.src = dataUrl;
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)),
  };
}

function renderSource(source) {
  clearNode(elements["source-summary"]);
  if (!source) return;
  const heading = document.createElement("strong");
  heading.textContent = "Visible tab screenshot";
  elements["source-summary"].append(heading);
  const detail = document.createElement("span");
  detail.textContent = "No page address, title, selection, DOM content, cookies, or browsing history is retained.";
  elements["source-summary"].append(detail);
}

function renderGoalPolicy() {
  const intent = session.intent;
  const required = goalRequired.has(intent);
  elements["goal-input"].required = required;
  elements["goal-label"].textContent = required ? "Your goal" : "Optional clue";
  const help = {
    troubleshoot: "Required: describe the symptom and what you expected.",
    compare: "Required: name the other option in text; this flow accepts one image.",
    guide: "Required: describe the outcome you want to reach.",
  }[intent] || "A short clue can improve the result.";
  elements["goal-help"].textContent = help;
  elements["goal-count"].textContent = `${session.goal.length}/500`;
}

function modelStatusText() {
  return {
    checking: "Checking Chrome and this device…",
    available: "Ready; the screenshot stays on this device.",
    downloadable: "Supported; Chrome downloads its model on first use.",
    downloading: "Chrome is downloading its on-device model.",
    unavailable: "Unavailable. Screenshot guides require Chrome 148+ on a supported desktop device.",
  }[modelCapability.availability] || "Unavailable. Screenshot guides require Chrome 148+ on a supported desktop device.";
}

function renderModelStatus() {
  elements["browser-ai-status"].textContent = modelStatusText();
  elements["privacy-pill"].textContent = "On-device AI";
  const boundaryTitle = elements["data-boundary"].querySelector("strong");
  const boundaryText = elements["data-boundary"].querySelector("span");
  boundaryTitle.textContent = "Processed by Chrome on this device";
  boundaryText.textContent = "Chrome may download its built-in model. The screenshot is not sent to us, a guide server, or the page you captured.";
  elements["generate-button"].textContent = "Guide on this device";
}

function appendTextList(node, items) {
  clearNode(node);
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    node.append(li);
  }
}

function renderResult(result) {
  const outerWarnings = session.responseWarnings || [];
  const warnings = [...result.warnings, ...outerWarnings];
  const clarification = result.clarificationQuestion || "";
  const clarificationBusy = session.status === "generating" && Boolean(clarification);
  elements["result-heading"].textContent = result.subject;
  elements["result-goal"].textContent = `${result.intent} · ${result.goal}`;
  elements["result-summary"].textContent = result.summary;
  elements["confidence-badge"].textContent = `${Math.round(result.confidence * 100)}% confidence`;

  elements["warnings-section"].hidden = warnings.length === 0;
  appendTextList(elements["warnings-list"], warnings);
  elements["clarification-section"].hidden = !clarification;
  elements["clarification-text"].textContent = clarification;
  if (clarification) {
    if (document.activeElement !== elements["clarification-input"]) {
      elements["clarification-input"].value = session.clarificationAnswer;
    }
    elements["clarification-input"].disabled = clarificationBusy;
    elements["clarification-input"].setAttribute("aria-invalid", String(Boolean(session.clarificationError)));
    elements["clarification-count"].textContent = `${session.clarificationAnswer.length}/500`;
    elements["clarification-error"].textContent = session.clarificationError || "";
    elements["clarification-error"].hidden = !session.clarificationError;
    elements["clarification-submit"].disabled = clarificationBusy
      || !session.clarificationAnswer.trim()
      || !modelCapability.supported;
    elements["clarification-submit"].textContent = clarificationBusy ? "Updating…" : "Update guide";
  }
  elements["recommendation-section"].hidden = Boolean(clarification);
  elements["recommendation-heading"].textContent = result.recommendedAction.title;
  elements["recommendation-reason"].textContent = result.recommendedAction.reason;

  elements["evidence-section"].hidden = result.evidence.length === 0;
  clearNode(elements["evidence-list"]);
  for (const evidence of result.evidence) {
    const li = document.createElement("li");
    const claim = document.createElement("span");
    claim.textContent = evidence.claim;
    li.append(claim);
    if (evidence.visibleSource) {
      const source = document.createElement("small");
      source.textContent = evidence.visibleSource;
      li.append(source);
    }
    elements["evidence-list"].append(li);
  }

  elements["steps-section"].hidden = result.steps.length === 0;
  clearNode(elements["steps-list"]);
  for (const step of result.steps) {
    const li = document.createElement("li");
    const content = document.createElement("div");
    content.className = "step-content";
    const title = document.createElement("h3");
    title.textContent = step.title;
    const instruction = document.createElement("p");
    instruction.textContent = step.instruction;
    content.append(title, instruction);
    if (step.risk) {
      const risk = document.createElement("span");
      risk.className = "step-risk";
      risk.textContent = `Risk: ${step.risk}`;
      content.append(risk);
    }
    if (step.completionCheck) {
      const check = document.createElement("span");
      check.className = "step-check";
      check.textContent = `Check: ${step.completionCheck}`;
      content.append(check);
    }
    li.append(content);
    elements["steps-list"].append(li);
  }

  elements["checks-section"].hidden = result.completionChecks.length === 0;
  appendTextList(elements["checks-list"], result.completionChecks);
  elements["alternatives-section"].hidden = result.alternatives.length === 0;
  clearNode(elements["alternatives-list"]);
  for (const alternative of result.alternatives) {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${alternative.title}: `;
    li.append(strong, document.createTextNode(alternative.tradeoff));
    elements["alternatives-list"].append(li);
  }
  elements["sources-section"].hidden = result.sources.length === 0;
  clearNode(elements["sources-list"]);
  for (const source of result.sources) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.label;
    li.append(link);
    elements["sources-list"].append(li);
  }
  elements["processing-line"].textContent = `Processed by ${result.processing.provider}${result.processing.model ? ` · ${result.processing.model}` : ""}${session.requestId ? ` · Request ${session.requestId}` : ""}. Confirm safety-critical guidance independently.`;
}

function render() {
  const hasImage = Boolean(session.draft?.image?.dataUrl);
  const busy = session.status === "capturing" || session.status === "generating" || panelCapturePending;
  const ready = Number.isInteger(currentWindowId);
  elements["capture-empty"].hidden = hasImage;
  elements["preview-region"].hidden = !hasImage;
  elements["capture-button"].disabled = !ready || busy || panelCapturePending;
  elements["capture-button"].textContent = session.status === "capturing" || panelCapturePending ? "Capturing…" : hasImage ? "Capture again privately" : "Capture visible tab privately";
  elements["reset-button"].disabled = !ready || busy || panelCapturePending || (session.status === "idle" && !session.draft);
  elements["center-crop-button"].disabled = !hasImage || busy;
  elements["restore-image-button"].disabled = !session.draft?.image?.originalDataUrl || busy;
  elements["generate-button"].disabled = !ready || !hasImage || busy || !modelCapability.supported;
  elements["cancel-generation-button"].hidden = session.status !== "generating";
  elements["cancel-generation-button"].disabled = session.status !== "generating"
    || !activeGenerationController
    || activeGenerationController.signal.aborted;
  elements["intent-select"].disabled = !ready || busy;
  elements["goal-input"].disabled = !ready || busy;

  if (document.activeElement !== elements["intent-select"]) elements["intent-select"].value = session.intent;
  if (document.activeElement !== elements["goal-input"]) elements["goal-input"].value = session.goal;
  renderGoalPolicy();
  renderModelStatus();
  renderSource(session.draft?.source);
  if (hasImage) loadPreview(session.draft.image.dataUrl);

  const captureMessage = session.status === "capturing" || panelCapturePending
    ? "Capturing the visible area…"
    : session.captureError
      ? session.captureError
      : hasImage
      ? "Capture ready. Drag on the preview if you want a tighter crop."
      : session.status === "error" && !session.draft?.image
        ? session.error
        : "Ready when the tab is.";
  setStatus(elements["capture-status"], captureMessage, Boolean(session.captureError) || (session.status === "error" && !hasImage));
  const generateMessage = session.status === "generating"
    ? session.result?.clarificationQuestion ? "Updating your guide…" : "Making your guide…"
    : session.status === "error" && hasImage
      ? session.error
      : session.status === "complete"
        ? "Guide ready."
        : "";
  setStatus(elements["generate-status"], generateMessage, session.status === "error" && hasImage);

  const hasResult = Boolean(session.result);
  elements["result-panel"].hidden = !hasResult;
  if (hasResult) renderResult(session.result);
}

function queueSessionSave() {
  sessionSaveQueue.schedule({ value: session, windowId: currentWindowId });
}

function withPanelEdit(patch) {
  const nextRevision = Math.min(Number.MAX_SAFE_INTEGER, session.panelRevision + 1);
  return normalizeSession({ ...session, ...patch, panelRevision: nextRevision });
}

function applyIncomingSession(value) {
  const incoming = normalizeSession(value);
  if (activeGenerationOperation && !isCurrentGeneration(incoming, activeGenerationOperation)) return false;
  const sameDraft = Boolean(incoming.draft?.id && incoming.draft.id === session.draft?.id);
  if (sameDraft && !incoming.captureId && incoming.panelRevision < session.panelRevision) return false;
  session = incoming;
  render();
  return true;
}

function optimizedImageDataUrl() {
  if (!previewImage) return session.draft?.image?.dataUrl;
  const maxDimension = 1_600;
  const scale = Math.min(1, maxDimension / Math.max(previewImage.naturalWidth, previewImage.naturalHeight));
  if (scale === 1 && previewUrl.length < 3_500_000) return previewUrl;
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(previewImage.naturalWidth * scale));
  output.height = Math.max(1, Math.round(previewImage.naturalHeight * scale));
  output.getContext("2d").drawImage(previewImage, 0, 0, output.width, output.height);
  return output.toDataURL("image/jpeg", 0.84);
}

function boundedCanvasJpeg(sourceCanvas, initialQuality = 0.86) {
  let working = sourceCanvas;
  for (let sizeAttempt = 0; sizeAttempt < 6; sizeAttempt += 1) {
    for (const quality of [initialQuality, 0.75, 0.64, 0.53]) {
      const dataUrl = working.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= MAX_STORED_IMAGE_DATA_URL_LENGTH) {
        return { dataUrl, width: working.width, height: working.height };
      }
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.round(working.width * 0.8));
    smaller.height = Math.max(1, Math.round(working.height * 0.8));
    smaller.getContext("2d").drawImage(working, 0, 0, smaller.width, smaller.height);
    working = smaller;
  }
  throw new GuideAdapterError("The crop is too large to keep safely. Select a smaller area and try again.", "IMAGE_TOO_LARGE");
}

function selectCenterCrop() {
  if (!previewImage || session.status === "capturing" || session.status === "generating") {
    setStatus(elements["capture-status"], "Wait for the preview to finish loading, then select the center crop.", true);
    return;
  }
  const width = canvas.width * 0.7;
  const height = canvas.height * 0.7;
  cropRect = {
    x: (canvas.width - width) / 2,
    y: (canvas.height - height) / 2,
    width,
    height,
  };
  elements["apply-crop-button"].disabled = width < 40 || height < 40;
  drawPreview();
  setStatus(elements["capture-status"], "Centered crop selected. Choose Use crop to apply it.");
}

async function applyCrop() {
  if (!previewImage || !cropRect || cropRect.width < 40 || cropRect.height < 40) return;
  await sessionSaveQueue.cancelAndWait();
  const previousSession = session;
  try {
    const maxDimension = 1_800;
    const scale = Math.min(1, maxDimension / Math.max(cropRect.width, cropRect.height));
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(cropRect.width * scale));
    output.height = Math.max(1, Math.round(cropRect.height * scale));
    output.getContext("2d").drawImage(
      previewImage,
      cropRect.x, cropRect.y, cropRect.width, cropRect.height,
      0, 0, output.width, output.height,
    );
    const encoded = boundedCanvasJpeg(output);
    const currentImage = session.draft.image;
    session = normalizeSession({
      ...session,
      status: "ready",
      result: null,
      clarificationAnswer: "",
      clarificationError: null,
      generationId: null,
      captureError: null,
      error: null,
      draft: {
        ...session.draft,
        image: {
          ...currentImage,
          dataUrl: encoded.dataUrl,
          originalDataUrl: currentImage.originalDataUrl || currentImage.dataUrl,
          width: encoded.width,
          height: encoded.height,
        },
      },
    });
    session = await saveSession(session, currentWindowId);
    render();
  } catch (error) {
    session = previousSession;
    render();
    setStatus(elements["capture-status"], error instanceof Error ? error.message : "The crop could not be saved.", true);
  }
}

async function restoreImage() {
  const original = session.draft?.image?.originalDataUrl;
  if (!original) return;
  await sessionSaveQueue.cancelAndWait();
  const previousSession = session;
  try {
    session = normalizeSession({
      ...session,
      status: "ready",
      result: null,
      clarificationAnswer: "",
      clarificationError: null,
      generationId: null,
      captureError: null,
      error: null,
      draft: { ...session.draft, image: { ...session.draft.image, dataUrl: original, originalDataUrl: null, width: null, height: null } },
    });
    session = await saveSession(session, currentWindowId);
    render();
  } catch (error) {
    session = previousSession;
    render();
    setStatus(elements["capture-status"], error instanceof Error ? error.message : "The full capture could not be restored.", true);
  }
}

async function generateGuide({ clarification = false } = {}) {
  const startingSession = session;
  const startingDraftId = startingSession.draft?.id;
  const clarificationQuestion = clarification ? startingSession.result?.clarificationQuestion : "";
  const clarificationAnswer = clarification ? startingSession.clarificationAnswer.trim() : "";
  let operation = null;
  let generationController = null;
  try {
    if (clarification && (!clarificationQuestion || !clarificationAnswer)) {
      throw new GuideAdapterError("Answer the clarification question before updating the guide.", "CLARIFICATION_REQUIRED");
    }
    const pageContext = clarification ? clarificationContext(clarificationQuestion, clarificationAnswer) : "";
    const request = buildGuideRequest({
      intent: startingSession.intent,
      image: optimizedImageDataUrl(),
      goal: startingSession.goal,
      pageContext,
    });
    if (session.draft?.id !== startingDraftId) return;

    const pendingSessionSave = sessionSaveQueue.cancelAndWait();
    operation = { draftId: startingDraftId, generationId: crypto.randomUUID() };
    generationController = new AbortController();
    activeGenerationController = generationController;
    activeGenerationOperation = operation;
    const generatingSession = normalizeSession({
      ...startingSession,
      status: "generating",
      result: clarification ? startingSession.result : null,
      error: null,
      clarificationError: null,
      clarificationAnswer: clarification ? startingSession.clarificationAnswer : "",
      responseWarnings: clarification ? startingSession.responseWarnings : [],
      requestId: clarification ? startingSession.requestId : null,
      generationId: operation.generationId,
    });
    session = generatingSession;
    render();
    const guideOptions = {
      onDownloadProgress(progress) {
        if (isCurrentGeneration(session, operation)) {
          setStatus(elements["generate-status"], `Downloading Chrome’s on-device model… ${Math.round(progress * 100)}%`);
        }
      },
      signal: generationController.signal,
    };
    // Chrome requires LanguageModel.create() to run directly in the user
    // activation path. Start browser AI before awaiting session persistence.
    const browserResponse = runBrowserGuide(request, guideOptions);
    void browserResponse.catch(() => undefined);
    try {
      await pendingSessionSave;
      session = await saveSession(generatingSession, currentWindowId);
    } catch (error) {
      generationController.abort();
      void browserResponse?.catch(() => undefined);
      operation = null;
      throw error;
    }
    const response = await browserResponse;
    const current = await loadSession(currentWindowId);
    if (!isCurrentGeneration(current, operation) || !isCurrentGeneration(session, operation)) {
      if (!isCurrentGeneration(current, operation)) {
        session = current;
        render();
      }
      return;
    }
    session = await saveSession(normalizeSession({
      ...current,
      status: "complete",
      result: response.result,
      responseWarnings: response.warnings,
      requestId: response.requestId,
      generationId: null,
      error: null,
      clarificationAnswer: "",
      clarificationError: null,
    }), currentWindowId);
    render();
    if (response.result.clarificationQuestion) elements["clarification-input"].focus();
    else elements["result-heading"].focus();
    elements["result-panel"].scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (error) {
    if (operation) {
      const current = await loadSession(currentWindowId).catch(() => session);
      if (!isCurrentGeneration(current, operation) || !isCurrentGeneration(session, operation)) {
        if (!isCurrentGeneration(current, operation)) {
          session = current;
          render();
        }
        return;
      }
      session = current;
    } else if (session.draft?.id !== startingDraftId) {
      return;
    }
    const message = error instanceof Error ? error.message : "The guide could not be made.";
    if (clarification && session.draft?.id === startingDraftId && (session.result || startingSession.result)) {
      session = normalizeSession({
        ...session,
        status: "error",
        result: session.result || startingSession.result,
        responseWarnings: session.responseWarnings?.length ? session.responseWarnings : startingSession.responseWarnings,
        requestId: session.requestId || startingSession.requestId,
        generationId: null,
        error: message,
        clarificationAnswer: startingSession.clarificationAnswer,
        clarificationError: message,
      });
      await saveSession(session, currentWindowId).catch(() => undefined);
      render();
      elements["clarification-input"].focus();
      return;
    }
    session = normalizeSession({
      ...session,
      status: "error",
      result: null,
      generationId: null,
      error: message,
    });
    await saveSession(session, currentWindowId).catch(() => undefined);
    render();
    elements["generate-button"].focus();
  } finally {
    if (activeGenerationController === generationController) {
      activeGenerationController = null;
      activeGenerationOperation = null;
    }
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (!previewImage || session.status === "capturing" || session.status === "generating") return;
  cropStart = pointerPosition(event);
  cropRect = { x: cropStart.x, y: cropStart.y, width: 0, height: 0 };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!cropStart || !canvas.hasPointerCapture(event.pointerId)) return;
  const current = pointerPosition(event);
  cropRect = {
    x: Math.min(cropStart.x, current.x),
    y: Math.min(cropStart.y, current.y),
    width: Math.abs(current.x - cropStart.x),
    height: Math.abs(current.y - cropStart.y),
  };
  drawPreview();
});

canvas.addEventListener("pointerup", (event) => {
  if (!cropStart) return;
  canvas.releasePointerCapture(event.pointerId);
  cropStart = null;
  elements["apply-crop-button"].disabled = !cropRect || cropRect.width < 40 || cropRect.height < 40;
  drawPreview();
});

elements["capture-button"].addEventListener("click", async () => {
  if (panelCapturePending || session.status === "capturing" || session.status === "generating") return;
  panelCapturePending = true;
  setStatus(elements["capture-status"], "Capturing the visible area…");
  render();
  let captureTransportError = "";
  try {
    await sessionSaveQueue.flush({ value: session, windowId: currentWindowId });
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_ACTIVE_TAB", windowId: currentWindowId });
    if (!response?.ok && response?.error) captureTransportError = response.error;
  } catch (error) {
    captureTransportError = error instanceof Error ? error.message : "The tab could not be captured.";
  } finally {
    panelCapturePending = false;
    render();
    if (captureTransportError) setStatus(elements["capture-status"], captureTransportError, true);
  }
});

elements["reset-button"].addEventListener("click", async () => {
  if (session.status === "capturing" || session.status === "generating") return;
  await sessionSaveQueue.cancelAndWait();
  session = await resetSession(currentWindowId);
  previewImage = null;
  previewUrl = "";
  cropRect = null;
  render();
});
elements["apply-crop-button"].addEventListener("click", () => void applyCrop());
elements["center-crop-button"].addEventListener("click", selectCenterCrop);
elements["restore-image-button"].addEventListener("click", () => void restoreImage());
elements["generate-button"].addEventListener("click", () => void generateGuide());
elements["cancel-generation-button"].addEventListener("click", () => {
  if (!activeGenerationController) return;
  activeGenerationController.abort();
  elements["cancel-generation-button"].disabled = true;
  setStatus(elements["generate-status"], "Cancelling guide…");
});
elements["clarification-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  if (!session.clarificationAnswer.trim()) {
    session = normalizeSession({ ...session, clarificationError: "Add an answer before updating the guide." });
    render();
    elements["clarification-input"].focus();
    queueSessionSave();
    return;
  }
  void generateGuide({ clarification: true });
});
elements["clarification-input"].addEventListener("input", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({
    clarificationAnswer: event.target.value,
    clarificationError: null,
  });
  renderResult(session.result);
  queueSessionSave();
});
elements["intent-select"].addEventListener("change", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({
    intent: event.target.value,
    result: null,
    clarificationAnswer: "",
    clarificationError: null,
    error: null,
    status: session.draft?.image ? "ready" : "idle",
  });
  render();
  queueSessionSave();
});

elements["goal-input"].addEventListener("input", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({
    goal: event.target.value,
    result: null,
    clarificationAnswer: "",
    clarificationError: null,
    error: null,
    status: session.draft?.image ? "ready" : "idle",
  });
  render();
  queueSessionSave();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && sessionStorageKey && changes[sessionStorageKey]) {
    applyIncomingSession(changes[sessionStorageKey].newValue);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "GUIDE_SESSION_UPDATED" || message.windowId !== currentWindowId) return;
  void loadSession(currentWindowId).then((value) => {
    applyIncomingSession(value);
  }).catch(() => setStatus(elements["capture-status"], "The updated capture could not be loaded.", true));
});

async function initialize() {
  const currentWindow = await chrome.windows.getCurrent();
  if (!Number.isInteger(currentWindow?.id)) throw new Error("Chrome could not identify this browser window.");
  currentWindowId = currentWindow.id;
  sessionStorageKey = sessionKeyForWindow(currentWindowId);
  const loadedSession = await loadSession(currentWindowId);
  session = recoverInterruptedGeneration(loadedSession);
  if (loadedSession.status === "generating") {
    session = await saveSession(session, currentWindowId);
  }
  render();
  modelCapability = await detectLanguageModel();
  render();
}

void initialize().catch((error) => {
  setStatus(elements["capture-status"], error instanceof Error ? error.message : "The extension could not start.", true);
});
