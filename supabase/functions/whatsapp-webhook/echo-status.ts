/** Provider echoes may arrive before or after the sender persists its row. */
export function echoStatus(direction: string, status: unknown): string {
  if (direction === "incoming") return "received";
  const state = typeof status === "string" ? status.toLowerCase() : "";
  if (state === "pending" || state === "queued") return "pending";
  if (state === "delivered") return "delivered";
  if (state === "read" || state === "played") return "read";
  if (state === "failed" || state === "error") return "failed";
  return "sent";
}

/** Atomic status-only promotion never overwrites later receipts or content. */
export function statusesBeforeEcho(status: string): string[] {
  if (status === "sent") return ["pending"];
  if (status === "delivered") return ["pending", "sent"];
  if (status === "read") return ["pending", "sent", "delivered"];
  return [];
}
