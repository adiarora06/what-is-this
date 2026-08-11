export function boundedText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function sourceForTab() {
  return { kind: "visible-tab" };
}
