import {
  DeferredSessionSaveQueue,
  isCurrentGeneration,
  loadSession,
  normalizeSession,
  recoverInterruptedGeneration,
  resetSession,
  saveSession,
  sessionKeyForTab,
} from "./session-store.js";
import { MAX_STORED_IMAGE_DATA_URL_LENGTH } from "./extension-policy.js";
import {
  GuideAdapterError,
  buildGuideRequest,
  clarificationContext,
  detectLanguageModel,
  followUpContext,
  runBrowserGuide,
} from "./guide-adapter.js";

const elements = Object.fromEntries([
  "privacy-pill", "readiness-panel", "readiness-indicator", "readiness-heading", "browser-ai-status",
  "model-download-progress", "web-app-link", "tab-context-notice", "capture-panel", "capture-toggle-button",
  "capture-summary", "capture-content", "reset-button", "capture-empty", "preview-region", "preview-canvas",
  "preview-loading", "apply-crop-button", "restore-image-button", "source-summary", "capture-button",
  "capture-status", "request-panel", "request-toggle-button", "request-summary", "request-summary-text",
  "request-content", "intent-select", "goal-label", "goal-input", "goal-help", "goal-count", "data-boundary",
  "generate-button", "cancel-generation-button", "generation-progress", "generate-status", "result-panel",
  "confidence-badge", "result-heading", "result-goal", "result-summary", "warnings-section", "warnings-list",
  "clarification-section", "clarification-text", "clarification-form", "clarification-input",
  "clarification-count", "clarification-error", "clarification-submit", "recommendation-section",
  "recommendation-heading", "recommendation-reason", "evidence-section", "evidence-list", "steps-section",
  "steps-list", "step-progress", "reset-progress-button", "checks-section", "checks-list",
  "alternatives-section", "alternatives-list", "sources-section", "sources-list", "follow-up-section",
  "follow-up-form", "follow-up-input", "follow-up-count", "follow-up-error", "follow-up-submit",
  "processing-line", "copy-guide-button", "retry-guide-button", "recapture-button", "new-question-button",
  "result-action-status",
].map((id) => [id, document.getElementById(id)]));

const canvas = elements["preview-canvas"];
const context = canvas.getContext("2d");
const goalRequired = new Set(["troubleshoot", "compare", "guide"]);
const intentLabels = {
  identify: "Identify",
  explain: "Explain",
  troubleshoot: "Troubleshoot",
  compare: "Compare",
  guide: "Step-by-step guide",
};

let session = normalizeSession();
let modelCapability = { supported: false, availability: "checking" };
let previewImage = null;
let previewUrl = "";
let cropRect = null;
let cropStart = null;
let currentWindowId = null;
let currentTabId = null;
let currentTabCaptureGranted = false;
let sessionStorageKey = null;
let activeGenerationController = null;
let activeGenerationOperation = null;
let panelCapturePending = false;
let captureExpanded = true;
let requestExpanded = true;
let tabNoticeTimer = null;
let generationProgressTimer = null;

const sessionSaveQueue = new DeferredSessionSaveQueue(
  ({ value, tabId }) => saveSession(value, tabId),
  { onError: () => setStatus(elements["generate-status"], "The session could not be saved.", true) },
);

function setStatus(element, message, isError = false) {
  element.textContent = message || "";
  element.classList.toggle("error", isError);
}

function startGenerationProgress(mode, operation, tabId) {
  clearInterval(generationProgressTimer);
  const messages = {
    clarification: ["Re-reading the capture with your answer…", "Updating the safest next step…", "Checking the revised guide…"],
    "follow-up": ["Connecting your question to the current guide…", "Re-checking the visible evidence…", "Preparing an updated answer…"],
    retry: ["Trying the capture again…", "Structuring a clearer next step…", "Checking the new guide…"],
    initial: ["Reading the visible details…", "Structuring a safe next step…", "Checking the guide before showing it…"],
  }[mode] || ["Making your guide…"];
  let index = 0;
  setStatus(elements["generate-status"], messages[index]);
  generationProgressTimer = setInterval(() => {
    if (currentTabId !== tabId || !isCurrentGeneration(session, operation)) return;
    if (modelCapability.availability === "downloading") return;
    index = Math.min(messages.length - 1, index + 1);
    setStatus(elements["generate-status"], messages[index]);
  }, 4_000);
}

function stopGenerationProgress() {
  clearInterval(generationProgressTimer);
  generationProgressTimer = null;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function resetPreviewState() {
  previewImage = null;
  previewUrl = "";
  cropRect = null;
  cropStart = null;
  context.clearRect(0, 0, canvas.width, canvas.height);
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
  elements["preview-loading"].textContent = "Preparing preview…";
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
  heading.textContent = "Visible screenshot only";
  const detail = document.createElement("span");
  detail.textContent = "No page address, title, DOM, form fields, cookies, or browsing history is retained.";
  elements["source-summary"].append(heading, detail);
}

function renderGoalPolicy() {
  const required = goalRequired.has(session.intent);
  elements["goal-input"].required = required;
  elements["goal-label"].textContent = required ? "Your goal" : "Optional clue";
  elements["goal-help"].textContent = {
    troubleshoot: "Required: describe the symptom and what you expected.",
    compare: "Required: name the other option in text; this flow accepts one image.",
    guide: "Required: describe the outcome you want to reach.",
  }[session.intent] || "A short clue can improve the result.";
  elements["goal-count"].textContent = `${session.goal.length}/500`;
}

function modelStatusText() {
  return {
    checking: ["Checking on-device AI…", "Checking Chrome and this device."],
    available: ["On-device AI is ready", "You can create private screenshot guides now."],
    downloadable: ["On-device AI is supported", "Chrome will download its model when you create the first guide."],
    downloading: ["Downloading the on-device model", "Keep this panel open. Processing will stay on this device."],
    unavailable: ["On-device AI is unavailable", "Screenshot guides require Chrome 148+ and a supported desktop device."],
  }[modelCapability.availability] || ["On-device AI is unavailable", "Screenshot guides require Chrome 148+ and a supported desktop device."];
}

function renderModelStatus() {
  const [heading, detail] = modelStatusText();
  elements["readiness-heading"].textContent = heading;
  elements["browser-ai-status"].textContent = detail;
  elements["readiness-panel"].classList.toggle("is-ready", modelCapability.availability === "available");
  elements["readiness-panel"].classList.toggle("is-download", ["downloadable", "downloading"].includes(modelCapability.availability));
  elements["readiness-panel"].classList.toggle("is-unavailable", modelCapability.availability === "unavailable");
  elements["web-app-link"].hidden = modelCapability.availability !== "unavailable";
  elements["privacy-pill"].textContent = "On-device";
}

function appendTextList(node, items) {
  clearNode(node);
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    node.append(li);
  }
}

function renderStepProgress(result) {
  const validIds = new Set(result.steps.map((step) => step.id));
  const completed = session.completedStepIds.filter((id) => validIds.has(id));
  const total = result.steps.length;
  elements["step-progress"].textContent = total ? `${completed.length} of ${total} completed` : "";
  elements["reset-progress-button"].hidden = completed.length === 0;
}

function renderResult(result) {
  const outerWarnings = session.responseWarnings || [];
  const warnings = [...result.warnings, ...outerWarnings];
  const clarification = result.clarificationQuestion || "";
  const busy = session.status === "generating";
  const clarificationBusy = busy && session.generationMode === "clarification";
  const followUpBusy = busy && session.generationMode === "follow-up";
  elements["result-heading"].textContent = result.subject;
  elements["result-goal"].textContent = `${intentLabels[result.intent] || result.intent} · ${result.goal}`;
  elements["result-summary"].textContent = result.summary;
  elements["confidence-badge"].textContent = `${Math.round(result.confidence * 100)}% confidence`;

  elements["warnings-section"].hidden = warnings.length === 0;
  appendTextList(elements["warnings-list"], warnings);
  elements["clarification-section"].hidden = !clarification;
  elements["clarification-text"].textContent = clarification;
  if (clarification) {
    if (document.activeElement !== elements["clarification-input"]) elements["clarification-input"].value = session.clarificationAnswer;
    elements["clarification-input"].disabled = busy;
    elements["clarification-input"].setAttribute("aria-invalid", String(Boolean(session.clarificationError)));
    elements["clarification-count"].textContent = `${session.clarificationAnswer.length}/500`;
    elements["clarification-error"].textContent = session.clarificationError || "";
    elements["clarification-error"].hidden = !session.clarificationError;
    elements["clarification-submit"].disabled = busy || !session.clarificationAnswer.trim() || !modelCapability.supported;
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
    const complete = session.completedStepIds.includes(step.id);
    const li = document.createElement("li");
    li.classList.toggle("is-complete", complete);
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
    const label = document.createElement("label");
    label.className = "step-complete-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = complete;
    checkbox.disabled = busy;
    checkbox.dataset.stepId = step.id;
    const labelText = document.createElement("span");
    labelText.textContent = complete ? "Completed" : "Mark complete";
    label.append(checkbox, labelText);
    content.append(label);
    li.append(content);
    elements["steps-list"].append(li);
  }
  renderStepProgress(result);

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

  elements["follow-up-section"].hidden = Boolean(clarification);
  if (!clarification) {
    if (document.activeElement !== elements["follow-up-input"]) elements["follow-up-input"].value = session.followUpQuestion;
    elements["follow-up-input"].disabled = busy;
    elements["follow-up-input"].setAttribute("aria-invalid", String(Boolean(session.followUpError)));
    elements["follow-up-count"].textContent = `${session.followUpQuestion.length}/500`;
    elements["follow-up-error"].textContent = session.followUpError || "";
    elements["follow-up-error"].hidden = !session.followUpError;
    elements["follow-up-submit"].disabled = busy || !session.followUpQuestion.trim() || !modelCapability.supported;
    elements["follow-up-submit"].textContent = followUpBusy ? "Updating…" : "Update guide";
  }
  elements["processing-line"].textContent = `Processed by ${result.processing.provider}${result.processing.model ? ` · ${result.processing.model}` : ""}${session.requestId ? ` · Request ${session.requestId}` : ""}. Confirm safety-critical guidance independently.`;
  for (const id of ["copy-guide-button", "retry-guide-button", "recapture-button", "new-question-button"]) {
    if (elements[id]) elements[id].disabled = busy;
  }
}

function renderStages(hasImage, hasResult) {
  elements["request-panel"].hidden = !hasImage;
  elements["capture-toggle-button"].hidden = !hasImage;
  elements["capture-toggle-button"].setAttribute("aria-expanded", String(captureExpanded));
  elements["capture-toggle-button"].textContent = captureExpanded ? "Collapse" : "Edit";
  elements["capture-content"].hidden = hasImage && !captureExpanded;
  elements["capture-summary"].hidden = !hasImage || captureExpanded;
  elements["capture-panel"].classList.toggle("is-complete", hasImage && !captureExpanded);

  elements["request-toggle-button"].hidden = !hasResult;
  elements["request-toggle-button"].setAttribute("aria-expanded", String(requestExpanded));
  elements["request-toggle-button"].textContent = requestExpanded ? "Collapse" : "Edit";
  elements["request-content"].hidden = hasResult && !requestExpanded;
  elements["request-summary"].hidden = !hasResult || requestExpanded;
  elements["request-summary-text"].textContent = `${intentLabels[session.intent] || session.intent}${session.goal ? ` · ${session.goal}` : ""}`;
  elements["request-panel"].classList.toggle("is-complete", hasResult && !requestExpanded);
}

function render() {
  const hasImage = Boolean(session.draft?.image?.dataUrl);
  const hasResult = Boolean(session.result);
  const busy = session.status === "capturing" || session.status === "generating" || panelCapturePending;
  const ready = Number.isInteger(currentWindowId) && Number.isInteger(currentTabId);
  renderStages(hasImage, hasResult);
  elements["capture-empty"].hidden = hasImage;
  elements["preview-region"].hidden = !hasImage;
  elements["capture-button"].disabled = !ready || !currentTabCaptureGranted || busy || !modelCapability.supported;
  elements["capture-button"].textContent = session.status === "capturing" || panelCapturePending ? "Capturing…" : hasImage ? "Capture this tab again" : "Capture visible tab privately";
  elements["reset-button"].disabled = !ready || busy || (session.status === "idle" && !session.draft);
  document.querySelectorAll(".crop-preset-button").forEach((button) => { button.disabled = !hasImage || busy; });
  document.querySelectorAll(".prompt-chip, .follow-up-chip").forEach((button) => { button.disabled = busy; });
  elements["apply-crop-button"].disabled = !hasImage || busy || !cropRect || cropRect.width < 40 || cropRect.height < 40;
  elements["restore-image-button"].disabled = !session.draft?.image?.originalDataUrl || busy;
  elements["generate-button"].disabled = !ready || !hasImage || busy || !modelCapability.supported;
  elements["cancel-generation-button"].hidden = session.status !== "generating";
  elements["cancel-generation-button"].disabled = session.status !== "generating" || !activeGenerationController || activeGenerationController.signal.aborted;
  elements["generation-progress"].hidden = session.status !== "generating";
  elements["intent-select"].disabled = !ready || busy;
  elements["goal-input"].disabled = !ready || busy;

  if (document.activeElement !== elements["intent-select"]) elements["intent-select"].value = session.intent;
  if (document.activeElement !== elements["goal-input"]) elements["goal-input"].value = session.goal;
  renderGoalPolicy();
  renderModelStatus();
  renderSource(session.draft?.source);
  if (hasImage) loadPreview(session.draft.image.dataUrl);

  const captureMessage = session.status === "capturing" || panelCapturePending
    ? "Capturing this tab’s visible area…"
    : session.captureError
      ? session.captureError
      : hasImage
        ? "Capture ready. Crop it if a smaller area would improve the answer."
        : !ready || !currentTabCaptureGranted
          ? "Click the extension toolbar icon on this tab before capturing it."
          : modelCapability.availability === "unavailable"
            ? "This device cannot create on-device screenshot guides."
            : "Ready when the tab is.";
  setStatus(elements["capture-status"], captureMessage, Boolean(session.captureError));
  const modeLabel = { clarification: "Updating with your answer…", "follow-up": "Answering your follow-up…", retry: "Trying the guide again…", initial: "Examining the visible screenshot…" };
  const generateMessage = session.status === "generating"
    ? modeLabel[session.generationMode] || "Making your guide…"
    : session.status === "error" && hasImage
      ? session.error
      : session.status === "complete"
        ? "Guide ready."
        : "";
  setStatus(elements["generate-status"], generateMessage, session.status === "error" && hasImage);
  elements["result-panel"].hidden = !hasResult;
  if (hasResult) renderResult(session.result);
}

function queueSessionSave() {
  if (!Number.isInteger(currentTabId)) return;
  sessionSaveQueue.schedule({ value: session, tabId: currentTabId });
}

function withPanelEdit(patch) {
  const nextRevision = Math.min(Number.MAX_SAFE_INTEGER, session.panelRevision + 1);
  return normalizeSession({ ...session, ...patch, panelRevision: nextRevision });
}

function applyIncomingSession(value, tabId = currentTabId) {
  if (tabId !== currentTabId) return false;
  const incoming = normalizeSession(value);
  if (activeGenerationOperation && !isCurrentGeneration(incoming, activeGenerationOperation)) return false;
  const sameDraft = Boolean(incoming.draft?.id && incoming.draft.id === session.draft?.id);
  if (sameDraft && !incoming.captureId && incoming.panelRevision < session.panelRevision) return false;
  const newCapture = Boolean(incoming.draft?.id && incoming.draft.id !== session.draft?.id);
  session = incoming;
  if (newCapture) {
    resetPreviewState();
    captureExpanded = false;
    requestExpanded = true;
  }
  render();
  if (newCapture) elements["request-heading"].scrollIntoView({ block: "start", behavior: "smooth" });
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
      if (dataUrl.length <= MAX_STORED_IMAGE_DATA_URL_LENGTH) return { dataUrl, width: working.width, height: working.height };
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.round(working.width * 0.8));
    smaller.height = Math.max(1, Math.round(working.height * 0.8));
    smaller.getContext("2d").drawImage(working, 0, 0, smaller.width, smaller.height);
    working = smaller;
  }
  throw new GuideAdapterError("The crop is too large to keep safely. Select a smaller area and try again.", "IMAGE_TOO_LARGE");
}

function clampCrop(rect) {
  const width = Math.max(40, Math.min(canvas.width, rect.width));
  const height = Math.max(40, Math.min(canvas.height, rect.height));
  return {
    x: Math.max(0, Math.min(canvas.width - width, rect.x)),
    y: Math.max(0, Math.min(canvas.height - height, rect.y)),
    width,
    height,
  };
}

function selectCropPreset(preset = "center") {
  if (!previewImage || session.status === "capturing" || session.status === "generating") return;
  const width = canvas.width * 0.82;
  const height = canvas.height * 0.48;
  const y = preset === "top" ? canvas.height * 0.04 : preset === "bottom" ? canvas.height - height - canvas.height * 0.04 : (canvas.height - height) / 2;
  cropRect = clampCrop({ x: (canvas.width - width) / 2, y, width, height });
  drawPreview();
  render();
  setStatus(elements["capture-status"], `${preset[0].toUpperCase()}${preset.slice(1)} crop selected. Choose Use selected crop to apply it.`);
  canvas.focus();
}

async function applyCrop() {
  if (!previewImage || !cropRect || cropRect.width < 40 || cropRect.height < 40) return;
  await sessionSaveQueue.cancelAndWait();
  const previousSession = session;
  const tabId = currentTabId;
  try {
    const maxDimension = 1_800;
    const scale = Math.min(1, maxDimension / Math.max(cropRect.width, cropRect.height));
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(cropRect.width * scale));
    output.height = Math.max(1, Math.round(cropRect.height * scale));
    output.getContext("2d").drawImage(previewImage, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, output.width, output.height);
    const encoded = boundedCanvasJpeg(output);
    const currentImage = session.draft.image;
    session = normalizeSession({
      ...session,
      status: "ready",
      result: null,
      clarificationAnswer: "",
      clarificationError: null,
      followUpQuestion: "",
      followUpError: null,
      completedStepIds: [],
      generationId: null,
      generationMode: null,
      captureError: null,
      error: null,
      draft: { ...session.draft, image: { ...currentImage, dataUrl: encoded.dataUrl, originalDataUrl: currentImage.originalDataUrl || currentImage.dataUrl, width: encoded.width, height: encoded.height } },
    });
    session = await saveSession(session, tabId);
    resetPreviewState();
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
  const tabId = currentTabId;
  try {
    session = normalizeSession({
      ...session,
      status: "ready",
      result: null,
      clarificationAnswer: "",
      clarificationError: null,
      followUpQuestion: "",
      followUpError: null,
      completedStepIds: [],
      generationId: null,
      generationMode: null,
      captureError: null,
      error: null,
      draft: { ...session.draft, image: { ...session.draft.image, dataUrl: original, originalDataUrl: null, width: null, height: null } },
    });
    session = await saveSession(session, tabId);
    resetPreviewState();
    render();
  } catch (error) {
    session = previousSession;
    render();
    setStatus(elements["capture-status"], error instanceof Error ? error.message : "The full capture could not be restored.", true);
  }
}

async function generateGuide({ mode = "initial" } = {}) {
  const startingSession = session;
  const startingDraftId = startingSession.draft?.id;
  const startingTabId = currentTabId;
  const clarificationQuestion = mode === "clarification" ? startingSession.result?.clarificationQuestion : "";
  const clarificationAnswer = mode === "clarification" ? startingSession.clarificationAnswer.trim() : "";
  const followUpQuestion = mode === "follow-up" ? startingSession.followUpQuestion.trim() : "";
  let operation = null;
  let generationController = null;
  try {
    if (mode === "clarification" && (!clarificationQuestion || !clarificationAnswer)) {
      throw new GuideAdapterError("Answer the clarification question before updating the guide.", "CLARIFICATION_REQUIRED");
    }
    if (mode === "follow-up" && (!startingSession.result || !followUpQuestion)) {
      throw new GuideAdapterError("Add a follow-up question before updating the guide.", "FOLLOW_UP_REQUIRED");
    }
    const pageContext = mode === "clarification"
      ? clarificationContext(clarificationQuestion, clarificationAnswer)
      : mode === "follow-up"
        ? followUpContext(startingSession.result, followUpQuestion)
        : "";
    const request = buildGuideRequest({ intent: startingSession.intent, image: optimizedImageDataUrl(), goal: startingSession.goal, pageContext });
    if (currentTabId !== startingTabId || session.draft?.id !== startingDraftId) return;

    const pendingSessionSave = sessionSaveQueue.cancelAndWait();
    operation = { draftId: startingDraftId, generationId: crypto.randomUUID(), tabId: startingTabId };
    generationController = new AbortController();
    activeGenerationController = generationController;
    activeGenerationOperation = operation;
    const preserveResult = ["clarification", "follow-up"].includes(mode);
    const generatingSession = normalizeSession({
      ...startingSession,
      status: "generating",
      result: preserveResult ? startingSession.result : null,
      error: null,
      clarificationError: null,
      followUpError: null,
      responseWarnings: preserveResult ? startingSession.responseWarnings : [],
      requestId: preserveResult ? startingSession.requestId : null,
      generationId: operation.generationId,
      generationMode: mode,
    });
    session = generatingSession;
    render();
    startGenerationProgress(mode, operation, startingTabId);
    const browserResponse = runBrowserGuide(request, {
      onDownloadProgress(progress) {
        if (currentTabId !== startingTabId || !isCurrentGeneration(session, operation)) return;
        modelCapability = { supported: true, availability: "downloading" };
        elements["model-download-progress"].hidden = false;
        elements["model-download-progress"].value = progress;
        elements["model-download-progress"].textContent = `${Math.round(progress * 100)}%`;
        renderModelStatus();
        setStatus(elements["generate-status"], `Downloading Chrome’s on-device model… ${Math.round(progress * 100)}%`);
      },
      signal: generationController.signal,
    });
    void browserResponse.catch(() => undefined);
    try {
      await pendingSessionSave;
      if (currentTabId !== startingTabId) throw new GuideAdapterError("The active tab changed. The guide was cancelled.", "MODEL_CANCELLED");
      session = await saveSession(generatingSession, startingTabId);
    } catch (error) {
      generationController.abort();
      void browserResponse.catch(() => undefined);
      operation = null;
      throw error;
    }
    const response = await browserResponse;
    if (currentTabId !== startingTabId) return;
    const current = await loadSession(startingTabId);
    if (!isCurrentGeneration(current, operation) || !isCurrentGeneration(session, operation)) {
      if (!isCurrentGeneration(current, operation)) applyIncomingSession(current, startingTabId);
      return;
    }
    session = await saveSession(normalizeSession({
      ...current,
      status: "complete",
      result: response.result,
      responseWarnings: response.warnings,
      requestId: response.requestId,
      generationId: null,
      generationMode: null,
      error: null,
      clarificationAnswer: "",
      clarificationError: null,
      followUpQuestion: "",
      followUpError: null,
      completedStepIds: [],
    }), startingTabId);
    modelCapability = { supported: true, availability: "available" };
    elements["model-download-progress"].hidden = true;
    captureExpanded = false;
    requestExpanded = false;
    render();
    if (response.result.clarificationQuestion) elements["clarification-input"].focus();
    else elements["result-heading"].focus();
    elements["result-panel"].scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (error) {
    if (currentTabId !== startingTabId) return;
    if (operation) {
      const current = await loadSession(startingTabId).catch(() => session);
      if (!isCurrentGeneration(current, operation) || !isCurrentGeneration(session, operation)) {
        if (!isCurrentGeneration(current, operation)) applyIncomingSession(current, startingTabId);
        return;
      }
      session = current;
    } else if (session.draft?.id !== startingDraftId) return;
    const message = error instanceof Error ? error.message : "The guide could not be made.";
    const preserveResult = ["clarification", "follow-up"].includes(mode) && (session.result || startingSession.result);
    session = normalizeSession({
      ...session,
      status: "error",
      result: preserveResult ? session.result || startingSession.result : null,
      responseWarnings: preserveResult ? session.responseWarnings?.length ? session.responseWarnings : startingSession.responseWarnings : [],
      requestId: preserveResult ? session.requestId || startingSession.requestId : null,
      generationId: null,
      generationMode: null,
      error: message,
      clarificationAnswer: mode === "clarification" ? startingSession.clarificationAnswer : session.clarificationAnswer,
      clarificationError: mode === "clarification" ? message : null,
      followUpQuestion: mode === "follow-up" ? startingSession.followUpQuestion : session.followUpQuestion,
      followUpError: mode === "follow-up" ? message : null,
    });
    await saveSession(session, startingTabId).catch(() => undefined);
    render();
    if (mode === "clarification") elements["clarification-input"].focus();
    else if (mode === "follow-up") elements["follow-up-input"].focus();
    else elements["generate-button"].focus();
  } finally {
    stopGenerationProgress();
    if (activeGenerationController === generationController) {
      activeGenerationController = null;
      activeGenerationOperation = null;
      render();
    }
  }
}

function formatGuide(result) {
  const lines = [result.subject, "", result.summary];
  if (result.clarificationQuestion) lines.push("", `Needs clarification: ${result.clarificationQuestion}`);
  else lines.push("", `Recommended next move: ${result.recommendedAction.title}`, result.recommendedAction.reason);
  if (result.warnings.length) lines.push("", "Warnings", ...result.warnings.map((item) => `- ${item}`));
  if (result.steps.length) lines.push("", "Steps", ...result.steps.flatMap((step, index) => [`${index + 1}. ${step.title}`, `   ${step.instruction}`, step.completionCheck ? `   Check: ${step.completionCheck}` : "", step.risk ? `   Risk: ${step.risk}` : ""].filter(Boolean)));
  if (result.completionChecks.length) lines.push("", "You’re done when", ...result.completionChecks.map((item) => `- ${item}`));
  lines.push("", "Created privately with What Is This? Guide using Chrome on-device AI.");
  return lines.join("\n");
}

async function switchToTab(tabId, { announce = true, captureGranted = false } = {}) {
  if (!Number.isInteger(tabId) || tabId === currentTabId) return;
  const previousTabId = currentTabId;
  if (activeGenerationController) {
    activeGenerationController.abort();
    await sessionSaveQueue.cancelAndWait();
    if (Number.isInteger(previousTabId)) {
      await saveSession(recoverInterruptedGeneration(session), previousTabId).catch(() => undefined);
    }
  } else if (Number.isInteger(previousTabId)) {
    await sessionSaveQueue.flush({ value: session, tabId: previousTabId }).catch(() => undefined);
  } else {
    await sessionSaveQueue.cancelAndWait();
  }
  currentTabId = tabId;
  currentTabCaptureGranted = Boolean(captureGranted);
  sessionStorageKey = sessionKeyForTab(tabId);
  resetPreviewState();
  const loaded = await loadSession(tabId);
  session = recoverInterruptedGeneration(loaded);
  if (loaded.status === "generating") session = await saveSession(session, tabId);
  captureExpanded = !session.draft?.image;
  requestExpanded = Boolean(session.draft?.image && !session.result);
  render();
  if (announce) {
    elements["tab-context-notice"].hidden = false;
    clearTimeout(tabNoticeTimer);
    tabNoticeTimer = setTimeout(() => { elements["tab-context-notice"].hidden = true; }, 5000);
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
  cropRect = { x: Math.min(cropStart.x, current.x), y: Math.min(cropStart.y, current.y), width: Math.abs(current.x - cropStart.x), height: Math.abs(current.y - cropStart.y) };
  drawPreview();
});
canvas.addEventListener("pointerup", (event) => {
  if (!cropStart) return;
  canvas.releasePointerCapture(event.pointerId);
  cropStart = null;
  drawPreview();
  render();
});
canvas.addEventListener("keydown", (event) => {
  if (!previewImage || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  if (!cropRect) selectCropPreset("center");
  const horizontal = canvas.width * 0.025;
  const vertical = canvas.height * 0.025;
  const next = { ...cropRect };
  if (event.shiftKey) {
    if (event.key === "ArrowLeft") next.width -= horizontal;
    if (event.key === "ArrowRight") next.width += horizontal;
    if (event.key === "ArrowUp") next.height -= vertical;
    if (event.key === "ArrowDown") next.height += vertical;
  } else {
    if (event.key === "ArrowLeft") next.x -= horizontal;
    if (event.key === "ArrowRight") next.x += horizontal;
    if (event.key === "ArrowUp") next.y -= vertical;
    if (event.key === "ArrowDown") next.y += vertical;
  }
  cropRect = clampCrop(next);
  drawPreview();
  render();
  setStatus(elements["capture-status"], "Crop adjusted with the keyboard. Choose Use selected crop to apply it.");
});

document.querySelectorAll(".crop-preset-button").forEach((button) => button.addEventListener("click", () => selectCropPreset(button.dataset.cropPreset)));

elements["capture-button"].addEventListener("click", async () => {
  if (panelCapturePending || session.status === "capturing" || session.status === "generating") return;
  panelCapturePending = true;
  setStatus(elements["capture-status"], "Capturing this tab’s visible area…");
  render();
  let captureTransportError = "";
  try {
    await sessionSaveQueue.flush({ value: session, tabId: currentTabId });
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_ACTIVE_TAB", windowId: currentWindowId, tabId: currentTabId });
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
  session = await resetSession(currentTabId);
  resetPreviewState();
  captureExpanded = true;
  requestExpanded = true;
  render();
});
elements["capture-toggle-button"].addEventListener("click", () => { captureExpanded = !captureExpanded; render(); });
elements["request-toggle-button"].addEventListener("click", () => { requestExpanded = !requestExpanded; render(); });
elements["apply-crop-button"].addEventListener("click", () => void applyCrop());
elements["restore-image-button"].addEventListener("click", () => void restoreImage());
elements["generate-button"].addEventListener("click", () => void generateGuide({ mode: session.result ? "retry" : "initial" }));
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
  void generateGuide({ mode: "clarification" });
});
elements["clarification-input"].addEventListener("input", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({ clarificationAnswer: event.target.value, clarificationError: null });
  renderResult(session.result);
  queueSessionSave();
});

elements["follow-up-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  if (!session.followUpQuestion.trim()) {
    session = normalizeSession({ ...session, followUpError: "Add a question before updating the guide." });
    render();
    elements["follow-up-input"].focus();
    queueSessionSave();
    return;
  }
  void generateGuide({ mode: "follow-up" });
});
elements["follow-up-input"].addEventListener("input", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({ followUpQuestion: event.target.value, followUpError: null });
  renderResult(session.result);
  queueSessionSave();
});
document.querySelectorAll(".follow-up-chip").forEach((button) => button.addEventListener("click", () => {
  if (session.status === "generating") return;
  session = withPanelEdit({ followUpQuestion: button.dataset.followUp || "", followUpError: null });
  render();
  queueSessionSave();
  elements["follow-up-input"].focus();
}));

document.querySelectorAll(".prompt-chip").forEach((button) => button.addEventListener("click", () => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({
    intent: button.dataset.intent,
    goal: button.dataset.goal || "",
    result: null,
    clarificationAnswer: "",
    clarificationError: null,
    followUpQuestion: "",
    followUpError: null,
    completedStepIds: [],
    error: null,
    status: session.draft?.image ? "ready" : "idle",
  });
  render();
  queueSessionSave();
  elements["goal-input"].focus();
}));

elements["intent-select"].addEventListener("change", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({ intent: event.target.value, result: null, clarificationAnswer: "", clarificationError: null, followUpQuestion: "", followUpError: null, completedStepIds: [], error: null, status: session.draft?.image ? "ready" : "idle" });
  render();
  queueSessionSave();
});
elements["goal-input"].addEventListener("input", (event) => {
  if (session.status === "capturing" || session.status === "generating") return;
  session = withPanelEdit({ goal: event.target.value, result: null, clarificationAnswer: "", clarificationError: null, followUpQuestion: "", followUpError: null, completedStepIds: [], error: null, status: session.draft?.image ? "ready" : "idle" });
  render();
  queueSessionSave();
});

elements["steps-list"].addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-step-id]');
  if (!checkbox || session.status === "generating") return;
  const ids = new Set(session.completedStepIds);
  if (checkbox.checked) ids.add(checkbox.dataset.stepId);
  else ids.delete(checkbox.dataset.stepId);
  session = withPanelEdit({ completedStepIds: [...ids] });
  renderResult(session.result);
  queueSessionSave();
  requestAnimationFrame(() => {
    const replacement = [...elements["steps-list"].querySelectorAll('input[type="checkbox"][data-step-id]')]
      .find((input) => input.dataset.stepId === checkbox.dataset.stepId);
    replacement?.focus();
  });
});
elements["reset-progress-button"].addEventListener("click", () => {
  session = withPanelEdit({ completedStepIds: [] });
  renderResult(session.result);
  queueSessionSave();
});

elements["copy-guide-button"].addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(formatGuide(session.result));
    setStatus(elements["result-action-status"], "Guide copied.");
  } catch {
    setStatus(elements["result-action-status"], "Chrome could not copy the guide. Select the text and copy it manually.", true);
  }
});
elements["retry-guide-button"].addEventListener("click", () => void generateGuide({ mode: "retry" }));
if (elements["recapture-button"]) elements["recapture-button"].addEventListener("click", () => {
  captureExpanded = true;
  requestExpanded = false;
  render();
  elements["capture-panel"].scrollIntoView({ block: "start", behavior: "smooth" });
  elements["capture-button"].focus();
});
elements["new-question-button"].addEventListener("click", () => {
  requestExpanded = true;
  captureExpanded = false;
  render();
  elements["request-panel"].scrollIntoView({ block: "start", behavior: "smooth" });
  elements["goal-input"].focus();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && sessionStorageKey && changes[sessionStorageKey]) applyIncomingSession(changes[sessionStorageKey].newValue);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "GUIDE_SESSION_UPDATED" || message.windowId !== currentWindowId || !Number.isInteger(message.tabId)) return;
  if (message.tabId !== currentTabId) {
    void switchToTab(message.tabId, { captureGranted: message.captureGranted }).catch(() => setStatus(elements["capture-status"], "The active tab could not be loaded.", true));
    return;
  }
  currentTabCaptureGranted = Boolean(message.captureGranted);
  void loadSession(currentTabId).then((value) => applyIncomingSession(value, currentTabId)).catch(() => setStatus(elements["capture-status"], "The updated capture could not be loaded.", true));
});

async function initialize() {
  const currentWindow = await chrome.windows.getCurrent();
  if (!Number.isInteger(currentWindow?.id)) throw new Error("Chrome could not identify this browser window.");
  currentWindowId = currentWindow.id;
  const response = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB_CONTEXT", windowId: currentWindowId });
  if (response?.ok && Number.isInteger(response.context?.tabId)) {
    await switchToTab(response.context.tabId, { announce: false, captureGranted: response.context.captureGranted });
  }
  else render();
  modelCapability = await detectLanguageModel();
  render();
}

void initialize().catch((error) => {
  setStatus(elements["capture-status"], error instanceof Error ? error.message : "The extension could not start.", true);
});
