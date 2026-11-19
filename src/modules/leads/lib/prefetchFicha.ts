import { useCallback, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import {
  leadDetailQuery,
  leadVisibilityQuery,
} from "../components/lead-detail/hooks/useLeadDetail";
import {
  LEADS_DEALS_STALE_MS,
  buscarNegociosDosLeads,
  leadsDealsQueryKey,
} from "../hooks/useLeadsDeals";

/** Ficha aquecida há menos que isso não é buscada de novo no próximo hover. */
const FRESCOR_DA_FICHA_MS = 30_000;

/**
 * Aquece a ficha (do lead e do negócio) antes do clique: visibilidade → linha
 * do lead + negócios do lead — as três primeiras idas da ficha, nas MESMAS
 * chaves e com as MESMAS funções que ela usa (`leadVisibilityQuery`,
 * `leadDetailQuery`, `leadsDealsQueryKey`). Respeita o portão de
 * visibilidade: lead que a pessoa não pode ver não tem a linha buscada.
 */
export async function prefetchFicha(
  qc: QueryClient,
  { leadId, organizationId }: { leadId: string; organizationId: string },
): Promise<void> {
  const visibilidade = await qc.fetchQuery(leadVisibilityQuery(leadId));
  if (visibilidade.status !== "exists") return;
  await Promise.all([
    qc.prefetchQuery({ ...leadDetailQuery(leadId), staleTime: FRESCOR_DA_FICHA_MS }),
    qc.prefetchQuery({
      queryKey: leadsDealsQueryKey(organizationId, [leadId]),
      queryFn: () => buscarNegociosDosLeads(organizationId, [leadId]),
      staleTime: LEADS_DEALS_STALE_MS,
    }),
  ]);
}

/**
 * `prefetchFicha` para o hover do card (use com `useIntencao(…, 150)`): um
 * aquecimento em voo por vez; falha é silenciosa — vira a carga normal da ficha.
 */
export function usePrefetchFicha(): (leadId: string | null | undefined) => void {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  const emVoo = useRef(false);

  return useCallback(
    (leadId) => {
      if (!leadId || !organizationId || emVoo.current) return;
      emVoo.current = true;
      prefetchFicha(qc, { leadId, organizationId })
        .catch(() => {})
        .finally(() => {
          emVoo.current = false;
        });
    },
    [qc, organizationId],
  );
}
