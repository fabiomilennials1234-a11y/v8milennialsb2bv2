import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { applyLeadListFilters } from "../lib/lead-list-filters";

/**
 * Leads de UM funil — de sistema ou customizado, sem quem chama precisar saber
 * a diferença.
 *
 * POR QUE UM HOOK NOVO, E NÃO `useLeads({ searchQuery })`
 *
 * `useLeads` não sabe filtrar por funil, e o seletor de lead da Agenda vinha
 * chamando `useLeads()` **sem argumento nenhum** — o que devolve a PRIMEIRA
 * PÁGINA de 50 leads da org (`LEADS_PAGE_SIZE`, `page = 0`, `.range(0, 49)`) e
 * filtrava em memória. Quem procurava o 51º lead recebia lista vazia sem erro,
 * e concluía que o campo estava quebrado.
 *
 * POR QUE A RAIZ É `leads` E O FUNIL É EMBED, E NÃO O CONTRÁRIO
 *
 *   1. **Dedup de graça.** Desde `20270730000050_deal_por_lead_destrava` os
 *      uniques caíram: o mesmo lead pode ter N entries no MESMO funil. Com a
 *      raiz em `pipeline_entries` o `.range()` contaria *entries* e o lead
 *      apareceria repetido no seletor. Com a raiz em `leads` as entries viram
 *      um array embutido e o lead aparece uma vez.
 *   2. **A RLS fica na ordem certa.** `leads` tem recorte por responsabilidade;
 *      `pipeline_entries` é org-wide. Com a raiz em `leads` nunca chega linha
 *      com o lead nulo — some o caso "card do funil visível, lead invisível",
 *      que obrigaria a peneirar `entry.lead != null` no cliente.
 *   3. **A busca é a MESMA da lista de Leads**, porque reusa
 *      `applyLeadListFilters` — nome, empresa, e-mail, telefone e o
 *      `normalized_phone` por dígitos. Sem essa reutilização, o seletor
 *      inventaria uma segunda semântica de busca que ia divergir da lista.
 *
 * POR QUE `pipeline_entries` SOZINHA COBRE OS DOIS TIPOS DE FUNIL
 *
 * `custom_pipe_entries` é espelhada 1:1 em `pipeline_entries` pelo trigger
 * `trg_sync_custom_pipe_to_entries`, com o MESMO `id` e o MESMO `pipeline_id`
 * — e `pipeline_id` de funil custom é o mesmo uuid da linha em `pipelines`,
 * porque `trg_sync_custom_pipeline` espelha `custom_pipelines` preservando o
 * id. Ou seja: um único `.eq("pipeline_entries.pipeline_id", id)` serve para
 * funil de sistema E customizado, sem um `if` sequer.
 *
 * Medido no PROD em 2026-08-26, e não deduzido do schema: 16.535 entries de
 * funil custom em `pipeline_entries`, **0** linhas de `custom_pipe_entries` sem
 * espelho, 30.523 entries de funil de sistema, **0** entries órfãs de
 * `pipelines`.
 *
 * PGRST201 NÃO se aplica aqui: `pipeline_entries` tem cinco FKs, mas só UMA
 * aponta `leads` (`pipeline_entries_lead_id_fkey`) — a relação é unívoca nos
 * dois sentidos e não precisa de hint. (O que de fato exige hint nessa
 * vizinhança é `team_members`, que tem três FKs a partir de
 * `custom_pipe_entries`.)
 *
 * SECURITY: filtra `organization_id` explicitamente, além da RLS. Nunca aceita
 * org por parâmetro — ela vem do contexto de auth.
 */

/** Linha enxuta — o seletor só precisa identificar a pessoa. */
export interface LeadDoFunil {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Quanto o seletor mostra de uma vez. Pequeno de propósito: é uma lista para
 * escolher, não para navegar. Acima disso a saída é refinar a busca, e a UI
 * avisa que há mais (ver `temMais`).
 */
export const LEADS_POR_FUNIL_PAGE_SIZE = 25;

export interface UseLeadsPorFunilParams {
  /** `null`/`undefined` desliga a consulta — é o estado "nenhum funil escolhido". */
  pipelineId?: string | null;
  /** Termo livre. Vazio = as primeiras `LEADS_POR_FUNIL_PAGE_SIZE` por nome. */
  search?: string;
}

export interface LeadsPorFunilResult {
  leads: LeadDoFunil[];
  /** Há mais leads além dos devolvidos — a UI pede para refinar a busca. */
  temMais: boolean;
}

interface LeadRow extends LeadDoFunil {
  /** Só existe para o `!inner` recortar; não é lido. */
  pipeline_entries?: unknown;
}

export function useLeadsPorFunil({
  pipelineId,
  search,
}: UseLeadsPorFunilParams): ReturnType<typeof useQuery<LeadsPorFunilResult>> {
  const { organizationId, isReady } = useOrganization();
  const termo = search?.trim() || undefined;

  return useQuery<LeadsPorFunilResult>({
    queryKey: ["leads-por-funil", organizationId, pipelineId, termo ?? ""],
    queryFn: async () => {
      if (!organizationId || !pipelineId) return { leads: [], temMais: false };

      // `!inner` recorta os leads que TÊM entry neste funil. O filtro
      // `pipeline_entries.pipeline_id` é o que faz o inner join morder — sem
      // ele o embed traria todo lead da org com as entries dele.
      //
      // ⚠️ Sem `let query = ...; query = query.or(...)`: encadear reatribuição
      // condicional sobre um builder COM embed é exatamente o que estoura o
      // TS2589 ("type instantiation excessively deep") documentado em
      // `useMeetings.ts`. Aqui a variação condicional é um ternário sobre o
      // mesmo tipo de builder, e o parser não precisa recursar.
      const base = supabase
        .from("leads")
        .select("id, name, company, phone, email, pipeline_entries!inner(pipeline_id)")
        .eq("organization_id", organizationId)
        .eq("pipeline_entries.pipeline_id", pipelineId)
        .is("deleted_at", null)
        // Lead na lixeira não é lead, e lead-sombra (criado só para ancorar uma
        // conversa) não é gente que se marque reunião. Mesmo par de guardas que
        // a lista de Leads usa.
        .or("is_shadow.is.null,is_shadow.eq.false");

      const comBusca = termo
        ? applyLeadListFilters(base, { searchQuery: termo })
        : base;

      // Pede UM a mais do que mostra: é como se sabe que há mais sem pagar um
      // `count(*)` exato a cada tecla digitada.
      const { data, error } = await comBusca
        .order("name", { ascending: true })
        .range(0, LEADS_POR_FUNIL_PAGE_SIZE);

      if (error) throw error;

      const linhas = (data ?? []) as unknown as LeadRow[];
      return {
        leads: linhas.slice(0, LEADS_POR_FUNIL_PAGE_SIZE).map((l) => ({
          id: l.id,
          name: l.name,
          company: l.company,
          phone: l.phone,
          email: l.email,
        })),
        temMais: linhas.length > LEADS_POR_FUNIL_PAGE_SIZE,
      };
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 30_000,
  });
}
