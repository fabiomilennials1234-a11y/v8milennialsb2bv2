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
import { useWhatsAppRealtimeStatus } from "@/shared/realtime/useRealtimeChannelStatus";
import type { RealtimeChannelState } from "@/lib/realtimeStatusStore";

export const FALLBACK_THRESHOLD_MS = 10_000;
export const FALLBACK_POLL_INTERVAL_MS = 10_000;
/**
 * Backstop de reconciliação aplicado MESMO quando o canal reporta "joined".
 *
 * Motivo: sob carga, o `apply_rls()` de `whatsapp_messages` (hot table, ~4.7x
 * overhead) atrasa/derruba postgres_changes sem derrubar o canal — o estado
 * fica "joined", `shouldFallback` retorna false e nenhum poll roda, então
 * mensagens/conversas novas só aparecem no F5. Este intervalo é um refetch de
 * segurança (belt-and-suspenders) que reconcilia o cache periodicamente. Só
 * dispara com a aba focada (refetchIntervalInBackground=false, default) → custo
 * baixo. Mais lento que o poll de fallback pra não pesar no caminho saudável.
 */
export const JOINED_BACKSTOP_POLL_INTERVAL_MS = 20_000;
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
