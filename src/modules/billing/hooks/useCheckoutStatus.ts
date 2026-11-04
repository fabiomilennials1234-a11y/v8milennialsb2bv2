import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCheckoutStatus } from "../lib/checkout-api";

// Os mesmos números de `billing-payment-status/status.ts`, que dimensionam o teto do endpoint.
// O front não importa código de edge function; `tests/unit/checkout-copy.test.ts` amarra os dois.
export const POLL_FAST_MS = 3_000;
export const POLL_SLOW_MS = 10_000;
export const POLL_FAST_WINDOW_MS = 120_000;
export const POLL_MAX_MS = 600_000;

export const statusPollDelay = (elapsedMs: number): number =>
  elapsedMs < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;

export type RegistrationState = "pending" | "paid" | "slow";

/**
 * "A assinatura já foi registrada do nosso lado?". Depois do `succeeded` da Stripe, `expired`
 * e `failed` são ignorados e falha de rede é silenciosa: nada aqui desdiz um pagamento.
 */
export function useCheckoutStatus(token: string | undefined, enabled: boolean): RegistrationState {
  const [startedAt] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const { data } = useQuery({
    queryKey: ["checkoutStatus"],
    queryFn: () => (token ? fetchCheckoutStatus(token) : Promise.resolve(null)),
    enabled,
    retry: false,
    gcTime: 0,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      if (query.state.data === "paid") return false;
      const elapsed = Date.now() - startedAt;
      return elapsed >= POLL_MAX_MS ? false : statusPollDelay(elapsed);
    },
  });

  useEffect(() => {
    if (!enabled || data === "paid") return;
    const id = window.setTimeout(() => setTimedOut(true), POLL_MAX_MS);
    return () => window.clearTimeout(id);
  }, [enabled, data]);

  if (data === "paid") return "paid";
  return timedOut ? "slow" : "pending";
}
