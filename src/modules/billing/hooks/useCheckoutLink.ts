import { useQuery } from "@tanstack/react-query";
import { fetchCheckoutLink, type LinkOutcome } from "../lib/checkout-api";

/**
 * O link pelo token da rota. A chave do cache NÃO leva o token: ele é credencial, e chave de
 * query aparece em devtools e em rastro. `gcTime: 0` tira o resultado da memória ao sair.
 */
export function useCheckoutLink(token: string | undefined) {
  return useQuery<LinkOutcome>({
    queryKey: ["checkoutLink"],
    queryFn: () => (token ? fetchCheckoutLink(token) : Promise.resolve({ kind: "not_found" as const })),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnMount: "always",
  });
}
