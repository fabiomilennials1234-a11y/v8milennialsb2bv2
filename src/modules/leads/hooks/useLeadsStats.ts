import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { LeadsFilterParams } from "./useLeads";
import { applyLeadListFilters } from "../lib/lead-list-filters";
import { coDonosDoFiltro } from "./useLeadOwners";
import { leadsKeys } from "../lib/leads-query-keys";
import { EMPTY_COUNT, runCappedCount, type CappedCount } from "../lib/capped-count";

/**
 * Os três números do topo da lista de Leads, contados na ORGANIZAÇÃO inteira.
 *
 * ── O QUE ISTO CONSERTA ───────────────────────────────────────────────────
 * Até aqui os cards viviam num `useMemo` dentro de `Leads.tsx` que filtrava o
 * array `leads` — e `leads` é **a página atual**, 25 linhas. O quarto card,
 * "Total", vinha de `useLeadsCount`, que conta a org.
 *
 * Ou seja: três números de página encostados num total de organização, sem nada
 * na tela marcando a diferença. Numa org com 2.987 leads, "leads deste mês"
 * reportava o que coubesse numa página. ADR-0024 decisão 2.
 *
 * ⚠️ Os números vão LER MAIOR no dia em que isto subir, em toda org com mais de
 * uma página. É a correção, não regressão — mas parece salto, e a piloto merece
 * ouvir antes.
 *
 * ── FUSO ──────────────────────────────────────────────────────────────────
 * "Deste mês" é cortado no fuso da ORG, não no do navegador. A versão anterior
 * usava `new Date().getMonth()` no cliente, então quem acessasse de outro fuso
 * via um mês diferente do que o resto do produto usa — o mesmo defeito de
 * fronteira que já apareceu no card do Comando.
 *
 * ── POR QUE DUAS QUERIES E NÃO UMA RPC ────────────────────────────────────
 * São duas contagens COM TETO (`select("id")` + `limit`, ver
 * `lib/capped-count`) — até 2026-10-05 eram `count: exact`, que varre o recorte
 * inteiro sob RLS e era o grosso do custo da tela. Uma RPC agregando as duas
 * seria uma ida ao banco em vez de duas, mas exigiria migration e mais uma
 * função `SECURITY DEFINER` com a superfície de ACL que este projeto já erra
 * com frequência.
 *
 * Acima do teto o card não sabe o total — e não finge: `capped: true`, e quem
 * desenha (`LeadsStatsV2`) não deriva nada por subtração de um valor cortado.
 */
export interface LeadsStats {
  thisMonth: CappedCount;
  withOwner: CappedCount;
}

/** Início do mês corrente no fuso informado, como instante UTC. */
export function monthStartInTz(timeZone: string): Date {
  const now = new Date();
  // `en-CA` devolve YYYY-MM-DD, que é o formato que dá pra fatiar sem regex.
  const [y, m] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);

  // Meia-noite do dia 1 NAQUELE fuso: constrói o instante e corrige pelo desvio
  // que o próprio fuso aplica àquele instante — sem isso o resultado sai
  // deslocado pelo fuso de quem está olhando.
  const palpite = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const comoLaSeVe = new Date(palpite.toLocaleString("en-US", { timeZone }));
  const comoAquiSeVe = new Date(palpite.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(palpite.getTime() + (comoAquiSeVe.getTime() - comoLaSeVe.getTime()));
}

export function useLeadsStats(filters: Omit<LeadsFilterParams, "page"> = {}) {
  const { organizationId, isReady, timezone } = useOrganization();
  const timeZone = timezone || "America/Sao_Paulo";

  const { searchQuery, filterOrigin, filterQualification, filterClassificacao, usaLeiDoErp, usaCadastroErpCafeJurere, filterUf, createdFrom, createdTo, filterResponsible, donosMultiplos } = filters;

  return useQuery<LeadsStats>({
    queryKey: leadsKeys.stats(organizationId, timeZone, {
      searchQuery, filterOrigin, filterQualification, filterClassificacao, usaLeiDoErp, usaCadastroErpCafeJurere, filterUf, createdFrom, createdTo, filterResponsible,
      ...(donosMultiplos ? { donosMultiplos } : {}),
    }),
    queryFn: async () => {
      if (!organizationId) return { thisMonth: EMPTY_COUNT, withOwner: EMPTY_COUNT };
      const coOwnedLeadIds = await coDonosDoFiltro(organizationId, { donosMultiplos, filterResponsible });

      const base = () => {
        const q = supabase
          .from("leads")
          .select("id")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          // Mesmo guard da lista (`applyLeadsFilters`): lead sombra não aparece
          // embaixo, então não pode entrar na conta de cima.
          .or("is_shadow.is.null,is_shadow.eq.false");

        // A semântica dos filtros vem de `applyLeadListFilters` — a MESMA função
        // que a lista e a exportação usam. Antes daqui este hook reimplementava
        // os filtros inline, e a cópia divergiu: `filterQualification` era
        // desestruturado, entrava na queryKey e NUNCA era aplicado (filtrar
        // mudava a lista e não mudava o card, com refetch a cada clique para
        // devolver o mesmo número), e a busca não casava `normalized_phone`,
        // então procurar por telefone dava contagem diferente do que estava na
        // tela.
        return applyLeadListFilters(q, {
          searchQuery, filterOrigin, filterQualification, filterClassificacao, usaLeiDoErp, usaCadastroErpCafeJurere,
          filterUf, createdFrom, createdTo, filterResponsible, donosMultiplos, coOwnedLeadIds,
        });
      };

      const inicioDoMes = monthStartInTz(timeZone).toISOString();

      const [thisMonth, withOwner] = await Promise.all([
        runCappedCount(base().gte("created_at", inicioDoMes)),
        runCappedCount(base().not("responsible_id", "is", null)),
      ]);

      return { thisMonth, withOwner };
    },
    enabled: isReady,
    staleTime: 60000,
  });
}
