/**
 * useClientInadimplencia — a Carteira Client's delinquency signal, derived from
 * its Títulos (S9, ADR-0020). Reads titulos_receber (written by the ERP syncs in
 * the integrations BC) and applies the pure computeInadimplencia projection.
 *
 * `vencimento` entra no select porque o selo usa a mesma régua do card de
 * títulos: status `atrasado` OU vencimento passado (Chamado 065e4890).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { computeInadimplencia, type Inadimplencia } from "../lib/inadimplencia";

const EMPTY: Inadimplencia = { isInadimplente: false, overdueCount: 0, receitaEmRisco: 0 };

export function useClientInadimplencia(clientId: string | null | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["client-inadimplencia", organizationId, clientId],
    queryFn: async (): Promise<Inadimplencia> => {
      if (!organizationId || !clientId) return EMPTY;
      const { data, error } = await supabase
        .from("titulos_receber")
        .select("status, valor, vencimento")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId);
      if (error) throw error;
      return computeInadimplencia(data ?? []);
    },
    enabled: !!organizationId && !!clientId,
    staleTime: 60_000,
  });
}
