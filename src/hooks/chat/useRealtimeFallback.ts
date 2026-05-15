/**
 * useWhatsAppRealtimeFallback — decide if React Query should fall back to
 * polling because the realtime channel has been off `joined` for too long.
 *
 * Returns { shouldPoll, reason }. Consumers set
 * `refetchInterval: shouldPoll ? FALLBACK_POLL_INTERVAL_MS : false` on
 * their queries; when realtime recovers (state === "joined") the flag
 * flips back to false and polling stops.
 *
 * Threshold: 120s. The channel's heartbeat already triggers reconnect at
 * 60s of staleness; we wait beyond that so a healthy reconnect (which
 * usually completes in seconds) does not trigger unnecessary polls.
 */
import { useEffect, useState } from "react";
import { useWhatsAppRealtimeStatus } from "@/hooks/useRealtimeChannelStatus";
import type { RealtimeChannelState } from "@/lib/realtimeStatusStore";

export const FALLBACK_THRESHOLD_MS = 120_000;
export const FALLBACK_POLL_INTERVAL_MS = 10_000;
const TICK_INTERVAL_MS = 15_000;

const NON_HEALTHY_STATES: RealtimeChannelState[] = [
  "offline",
  "stale",
  "reconnecting",
  "joining",
  "unknown",
];

export function shouldFallback(
  state: RealtimeChannelState,
  lastTransitionAt: number,
  now: number,
  thresholdMs: number = FALLBACK_THRESHOLD_MS,
): boolean {
  if (!NON_HEALTHY_STATES.includes(state)) return false;
  return now - lastTransitionAt >= thresholdMs;
}

export function useWhatsAppRealtimeFallback(
  organizationId: string | null | undefined,
): { shouldPoll: boolean } {
  const status = useWhatsAppRealtimeStatus(organizationId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!organizationId) return;
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [organizationId]);

  const shouldPoll = organizationId
    ? shouldFallback(status.state, status.lastTransitionAt, now)
    : false;

  return { shouldPoll };
}
