/** Persist acceptance as pending; delivery receipts advance the status later. */
export function providerSendStatus(data: unknown): "pending" | "sent" | "failed" {
  if (!data || typeof data !== "object") return "sent";
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return "sent"; // Legacy/recovered providers.
  const status = (result as Record<string, unknown>).status;
  return status === "queued" || status === "pending" ? "pending" : status === "failed" ? "failed" : "sent";
}
