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
