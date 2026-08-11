import { GuideGoalRequiredError, GuidePrivacyBoundaryError, GuideRequestError } from "./guide-client";

const SAFE_PREFIXES = [
  "Choose a ",
  "The selected image ",
  "The image could not ",
  "Camera access ",
  "The camera ",
  "No usable frame ",
  "Start the camera ",
];

export function friendlyScanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (SAFE_PREFIXES.some((prefix) => message.startsWith(prefix))) return message;
  if (/wasm|webassembly|no available backend|inference session/i.test(message)) {
    return "Private recognition could not start. Retry, or open Settings and choose another available mode.";
  }
  if (/download|failed to fetch|network|load failed/i.test(message)) {
    return "The private model could not be downloaded. Check your connection and retry.";
  }
  if (/timeout|timed out|abortsignal/i.test(message)) {
    return "Identification took too long. Retry with a clear photo or choose another recognition mode.";
  }
  if (/provider|configured|unavailable|api key|authentication/i.test(message)) {
    return "No recognition provider is currently available. Open Settings to choose an available mode.";
  }
  return "Identification did not finish. Retry or choose another recognition mode in Settings.";
}

export function friendlyCloudStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/verification|turnstile/i.test(message)) {
    return "Cloud verification is unavailable. On-device mode remains available.";
  }
  return "Cloud recognition is unavailable. On-device mode remains available.";
}

export function friendlyGuideError(error: unknown) {
  if (error instanceof GuidePrivacyBoundaryError || error instanceof GuideGoalRequiredError) return error.message;
  const message = error instanceof Error ? error.message : String(error || "");
  if (/too many guide requests/i.test(message)) return "Too many guide requests were made. Wait a moment and try again.";
  if (/security verification|verification.*(?:expired|failed|required)|turnstile/i.test(message)) {
    return "Cloud verification needs to be completed again before creating this guide.";
  }
  if (/did not pass safety checks|unsafe guide/i.test(message)) {
    return "That guidance did not pass the safety review. Add more context or ask for a safer alternative.";
  }
  if (/timed out|timeout|abort/i.test(message)) return "Guidance took too long. Try again with a shorter goal.";
  if (/unavailable|temporarily|no guide provider|requested guide service/i.test(message)) {
    return "Guided answers are temporarily unavailable. Your image was not saved by this app.";
  }
  if (/unreadable|invalid|expected|parse/i.test(message)) {
    return "The guide response could not be read safely. Try again.";
  }
  return "The guide could not be created. Try again or return to identification.";
}

export function guideErrorReference(error: unknown) {
  return error instanceof GuideRequestError ? error.requestId : undefined;
}
