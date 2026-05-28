function stringField(value: unknown, field: string): string {
  if (!value || typeof value !== "object" || !(field in value)) {
    return "";
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue.trim() : "";
}

export function formatUnknownError(reason: unknown, fallback: string): string {
  if (reason instanceof Error) {
    return reason.message || fallback;
  }

  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }

  const message = stringField(reason, "message");
  const details = stringField(reason, "details");
  const kind = stringField(reason, "kind");
  const summary = message || kind || fallback;

  if (details && details !== summary) {
    return `${summary}\n${details}`;
  }

  if (summary) {
    return summary;
  }

  return fallback;
}
