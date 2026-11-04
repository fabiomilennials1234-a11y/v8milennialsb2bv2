import { useCallback, useRef, useState } from "react";
import { startSubscription, type StartOutcome, type StartSubscriptionInput } from "../lib/checkout-api";

/**
 * Deliberadamente fora do `useMutation`: o React Query guarda `variables` no estado e no
 * MutationCache, e aqui elas carregam o CPF/CNPJ inteiro. Depois do POST o documento não pode
 * sobrar em lugar nenhum. O ref ignora o segundo clique sem desabilitar o botão, porque
 * `disabled` derruba o contraste do CTA para 3,79:1.
 */
export function useStartSubscription() {
  const [isPending, setPending] = useState(false);
  const inFlight = useRef(false);

  const start = useCallback(async (input: StartSubscriptionInput): Promise<StartOutcome | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    try {
      return await startSubscription(input);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return { start, isPending };
}
