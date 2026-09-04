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

/**
 * Uma posição do lead DENTRO do funil consultado.
 *
 * S6 — por que o embed deixou de ser só `pipeline_id`: a reunião passa a
 * gravar `meetings.deal_id`, e `uq_pipeline_entries_deal_id` (UNIQUE parcial
 * sobre `deal_id`) torna negócio ↔ entrada estritamente 1:1. Ou seja, escolher
 * o NEGÓCIO é o mesmo que escolher a ENTRADA — e a entrada é exatamente o que o
 * par (funil, lead) já resolve aqui. Trazer `deal_id` no embed que o `!inner`
 * já buscava dá o negócio DE GRAÇA: nenhuma query nova, nenhum clique a mais.
 *
 * `stage_name`/`stage_key` e `entered_at` só existem para ROTULAR o caso
 * ambíguo — medido em prod 2026-09-03: 30 pares (funil, lead) de 48.122 têm
 * mais de uma entrada no mesmo funil. Nesses 30 ninguém pode adivinhar por
 * conta própria: a pessoa escolhe, e para escolher precisa ver etapa e data.
 */
export interface EntradaDoFunil {
  id: string;
  /** `null` em 19,2% das entradas de prod — entrada sem negócio é normal. */
  deal_id: string | null;
  /**
   * Quando a entrada saiu do board. `null` = ainda viva.
   *
   * Está aqui porque é o que define "o negócio DESTE lead" para quem RESOLVE
   * um vínculo sozinho — ver `escolherLead` em `LeadPorFunilPicker`. É coluna
   * da própria entrada, então vem no `!inner` que já era buscado: nenhuma
   * query nova, nenhum join a mais.
   *
   * Medido em prod 2026-09-04: de 38.918 entradas com negócio, 36.871 estão
   * abertas — 2.047 fechadas que o seletor precisava aprender a ignorar.
   */
  closed_at: string | null;
  /**
   * Nome que a organização vê. Vem do embed `pipeline_stages(name)` da própria
   * entrada, e não de uma tabela de etapas resolvida à parte: `stage_key` é
   * slug (`reuniao_marcada`) e quem renomeou a etapa não reconheceria o que
   * está escolhendo. `null` quando a etapa foi apagada — 41 das 48.174 entradas
   * de prod estão sem `stage_id` (2026-09-03).
   */
  stage_name: string | null;
  stage_key: string | null;
  entered_at: string | null;
}

/** Linha enxuta — o seletor só precisa identificar a pessoa. */
export interface LeadDoFunil {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  /**
   * As entradas DESTE lead NESTE funil. Vem do mesmo `!inner` já filtrado por
   * `pipeline_entries.pipeline_id`, então o array nunca traz posição de outro
   * funil — o filtro no recurso embutido recorta o array, não só as linhas-pai.
   */
  entradas: EntradaDoFunil[];
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

/** Como o PostgREST devolve a linha: o embed é um array de entradas. */
interface LeadRow extends Omit<LeadDoFunil, "entradas"> {
  pipeline_entries?: Array<{
    id: string;
    pipeline_id: string;
    deal_id: string | null;
    closed_at: string | null;
    stage_key: string | null;
    entered_at: string | null;
    /** Embed 1:1 por `pipeline_entries_stage_id_fkey`; `null` sem `stage_id`. */
    pipeline_stages?: { name: string | null } | null;
  }> | null;
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
        .select(
          "id, name, company, phone, email, pipeline_entries!inner(id, pipeline_id, deal_id, closed_at, stage_key, entered_at, pipeline_stages(name))",
        )
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
          // Mais antiga primeiro: quando a pessoa precisa desempatar, a ordem
          // de entrada é a única que ela reconhece ("a que abri em julho").
          entradas: (l.pipeline_entries ?? [])
            .map((e) => ({
              id: e.id,
              deal_id: e.deal_id ?? null,
              closed_at: e.closed_at ?? null,
              stage_name: e.pipeline_stages?.name ?? null,
              stage_key: e.stage_key ?? null,
              entered_at: e.entered_at ?? null,
            }))
            .sort((a, b) => (a.entered_at ?? "").localeCompare(b.entered_at ?? "")),
        })),
        temMais: linhas.length > LEADS_POR_FUNIL_PAGE_SIZE,
      };
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 30_000,
  });
}
