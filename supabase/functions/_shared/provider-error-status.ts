/**
 * Provider rejections that are an expected, client-addressable outcome
 * ("Message not found" on downloadMedia/markRead), not a server fault.
 * The proxy forwards these statuses instead of collapsing them into 500, so
 * monitoring only counts genuine failures and the client sees the real cause.
 *
 * Deliberately a short allowlist: 429/5xx/timeout stay 500 because the chat
 * client's bounded recovery (send-recovery.ts) treats them as ambiguous.
 */
const PASSTHROUGH_STATUSES: ReadonlySet<number> = new Set([404, 422]);

export function providerPassthroughStatus(error: unknown): 404 | 422 | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && PASSTHROUGH_STATUSES.has(status) ? (status as 404 | 422) : null;
}
