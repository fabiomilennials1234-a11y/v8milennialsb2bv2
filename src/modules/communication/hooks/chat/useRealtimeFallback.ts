/**
 * useWhatsAppRealtimeFallback — activates polling when realtime is unhealthy.
 *
 * Returns { shouldPoll, mode, reason }. Consumers set
 * `refetchInterval: shouldPoll ? FALLBACK_POLL_INTERVAL_MS : false`.
 *
 * Activation rules:
 *   - Circuit breaker open (state "polling") → immediate poll
 *   - Non-healthy state for > 10s → poll as backup
 *   - State "joined" → no poll
 */
import { useEffect, useState } from "react";
import { useWhatsAppRealtimeStatus } from "@/hooks/useRealtimeChannelStatus";
import type { RealtimeChannelState } from "@/lib/realtimeStatusStore";

export const FALLBACK_THRESHOLD_MS = 10_000;
export const FALLBACK_POLL_INTERVAL_MS = 10_000;
const TICK_INTERVAL_MS = 5_000;

const NON_HEALTHY_STATES: RealtimeChannelState[] = [
  "offline",
  "reconnecting",
  "polling",
  "joining",
  "unknown",
];

export function shouldFallback(
  state: RealtimeChannelState,
  circuitOpen: boolean,
  lastTransitionAt: number,
  now: number,
  thresholdMs: number = FALLBACK_THRESHOLD_MS,
): boolean {
  if (state === "joined") return false;
  if (circuitOpen || state === "polling") return true;
  if (!NON_HEALTHY_STATES.includes(state)) return false;
  return now - lastTransitionAt >= thresholdMs;
}

export type FallbackMode = "realtime" | "polling" | "connecting" | "offline";

export type FallbackResult = {
  shouldPoll: boolean;
  mode: FallbackMode;
  reason: string | null;
};

export function useWhatsAppRealtimeFallback(
  organizationId: string | null | undefined,
): FallbackResult {
  const status = useWhatsAppRealtimeStatus(organizationId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!organizationId) return;
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [organizationId]);

  if (!organizationId) {
    return { shouldPoll: false, mode: "offline", reason: null };
  }

  const poll = shouldFallback(
    status.state,
    status.circuitOpen,
    status.lastTransitionAt,
    now,
  );

  let mode: FallbackMode;
  if (status.state === "joined") mode = "realtime";
  else if (poll) mode = "polling";
  else if (status.state === "joining" || status.state === "reconnecting")
    mode = "connecting";
  else mode = "offline";

  return { shouldPoll: poll, mode, reason: status.lastReason };
}
