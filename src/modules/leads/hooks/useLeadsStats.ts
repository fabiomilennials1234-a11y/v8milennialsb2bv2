import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { LeadsFilterParams } from "./useLeads";

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
 * ── POR QUE TRÊS QUERIES E NÃO UMA ────────────────────────────────────────
 * São três `head: true` com `count: exact`: o Postgres devolve só o número, sem
 * linha. Uma RPC agregando os três seria uma ida ao banco em vez de três, mas
 * exigiria migration e mais uma função `SECURITY DEFINER` com a superfície de
 * ACL que este projeto já erra com frequência. Três contagens paralelas em
 * `staleTime` de um minuto custam menos do que essa dívida.
 */
export interface LeadsStats {
  highRating: number;
  thisMonth: number;
  withOwner: number;
}

/** Início do mês corrente no fuso informado, como instante UTC. */
function monthStartInTz(timeZone: string): Date {
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

  const { searchQuery, filterOrigin, filterRating, filterQualification, filterUf, createdFrom, createdTo } = filters;

  return useQuery<LeadsStats>({
    queryKey: [
      "leads-stats", organizationId, timeZone,
      searchQuery, filterOrigin, filterRating, filterQualification, filterUf, createdFrom, createdTo,
    ],
    queryFn: async () => {
      if (!organizationId) return { highRating: 0, thisMonth: 0, withOwner: 0 };

      const base = () => {
        let q = supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .is("deleted_at", null);

        // Os mesmos recortes da lista, para o card concordar com o que está
        // embaixo dele. Um card que ignora o filtro ativo é outra forma de mentir.
        if (searchQuery) {
          q = q.or(`name.ilike.%${searchQuery}%,company.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
        }
        if (filterOrigin && filterOrigin !== "all") q = q.eq("origin", filterOrigin);
        if (filterUf && filterUf !== "all") q = q.eq("uf", filterUf);
        if (createdFrom) q = q.gte("created_at", createdFrom);
        if (createdTo) q = q.lte("created_at", createdTo);
        return q;
      };

      const inicioDoMes = monthStartInTz(timeZone).toISOString();

      const [alto, mes, comDono] = await Promise.all([
        base().gte("rating", 7),
        base().gte("created_at", inicioDoMes),
        base().not("responsible_id", "is", null),
      ]);

      if (alto.error) throw alto.error;
      if (mes.error) throw mes.error;
      if (comDono.error) throw comDono.error;

      return {
        highRating: alto.count ?? 0,
        thisMonth: mes.count ?? 0,
        withOwner: comDono.count ?? 0,
      };
    },
    enabled: isReady,
    staleTime: 60000,
  });
}
