export function transportLabel() {
  return document.documentElement.dataset.transport === "rtc" ? "Directo RTC" : "Relay";
}

export function transportDiagnostic() {
  try {
    return JSON.parse(document.documentElement.dataset.transportMetrics ?? "{}");
  } catch {
    return {};
  }
}
