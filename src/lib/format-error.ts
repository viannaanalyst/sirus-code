/** Browser delivery notices defer resize observations to the next paint. Keep
 * them in browser diagnostics rather than presenting them as failed app actions.
 * An actual thrown error, or any other message, still uses normal error handling.
 * https://www.w3.org/TR/resize-observer/#deliver-resize-error */
export function isResizeObserverDeliveryWarning(event: { message: string; error: unknown }): boolean {
  return event.error == null && (
    event.message === "ResizeObserver loop completed with undelivered notifications."
    || event.message === "ResizeObserver loop limit exceeded"
  );
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const code = typeof record.code === "string" ? record.code : null;
    if (message && code) return `${code}: ${message}`;
    if (message) return message;
    return "Unknown error";
  }
  return "Unknown error";
}
