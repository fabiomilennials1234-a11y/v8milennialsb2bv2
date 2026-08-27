import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type { LeadCardDealProduto } from "./types";

/**
 * Os produtos de cada negócio de UM lead, indexados pela posição
 * (`pipeline_entries.id`) — que é a chave pela qual a lista de negócios do card
 * do Lead conhece cada negócio.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR ─────────────────────────────────────────
 * `deal_items` só tinha um leitor em todo o repo, e ele era do painel do
 * NEGÓCIO. Abrindo a pessoa, os produtos sumiam: a ficha listava os negócios
 * dela sem dizer o que estava sendo vendido em cada um — e "o que estamos
 * vendendo para este cliente" é a pergunta que a ficha da pessoa existe para
 * responder.
 *
 * ⚠ Não confundir com `lead_products`, que é vizinha e responde OUTRA
 * pergunta: ela é o histórico AGREGADO do que a pessoa **já comprou**,
 * preenchido pelo gatilho `trg_deal_won_lead_products` só quando o negócio é
 * ganho. Aqui é o que está **em negociação agora**, ganho ou não.
 *
 * ── POR QUE DUAS CONSULTAS E NÃO UM EMBED ─────────────────────────────────
 * O caminho natural seria `deal_items` embutindo `deals`. Não dá, e por dois
 * motivos independentes: `deal_items` não tinha FK para `deals` (a migration
 * `produtos_do_negocio` — hoje `20270901000011` — cria, mas como NOT VALID e só
 * depois do apply), e embed ambíguo no PostgREST derruba a consulta INTEIRA com
 * `PGRST201` em vez de degradar. Duas consultas encadeadas não dependem de FK
 * nenhuma e falham no pior caso devolvendo lista vazia.
 */
export function useProdutosPorNegocio(leadId: string | null, isOpen: boolean) {
  return useQuery({
    queryKey: ["lead-card-produtos", leadId],
    enabled: isOpen && !!leadId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, LeadCardDealProduto[]>> => {
      if (!leadId) return {};

      // 1) as posições deste lead que TÊM identidade de negócio. `deal_id` é
      //    nulo em boa parte dos cards antigos — os que não foram alcançados
      //    pelo backfill M4 —, e esses simplesmente não têm onde guardar item.
      const { data: entradas, error: erroEntradas } = await supabase
        .from("pipeline_entries")
        .select("id, deal_id")
        .eq("lead_id", leadId)
        .not("deal_id", "is", null);

      if (erroEntradas) throw erroEntradas;

      const porNegocio = new Map<string, string>();
      for (const e of entradas ?? []) {
        const dealId = (e as { deal_id?: unknown }).deal_id;
        const entryId = (e as { id?: unknown }).id;
        if (typeof dealId === "string" && typeof entryId === "string") {
          porNegocio.set(dealId, entryId);
        }
      }
      if (porNegocio.size === 0) return {};

      // 2) os itens. A ordem tem de ser pedida: `sort_order` nasce 0 em todo
      //    item antigo, e sem `.order()` o Postgres devolve na ordem que
      //    quiser — a mesma lista reembaralharia entre dois carregamentos.
      const { data: itens, error: erroItens } = await supabase
        .from("deal_items")
        .select("deal_id, product_id, product_name, quantity, unit_price, total")
        .in("deal_id", [...porNegocio.keys()])
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (erroItens) throw erroItens;

      const saida: Record<string, LeadCardDealProduto[]> = {};
      for (const bruto of itens ?? []) {
        const i = bruto as Record<string, unknown>;
        const entryId = typeof i.deal_id === "string" ? porNegocio.get(i.deal_id) : undefined;
        if (!entryId) continue;

        (saida[entryId] ??= []).push({
          nome: typeof i.product_name === "string" ? i.product_name : "Item",
          quantidade: Number(i.quantity) || 0,
          precoUnitario: Number(i.unit_price) || 0,
          total: Number(i.total) || 0,
          avulso: typeof i.product_id !== "string",
        });
      }
      return saida;
    },
  });
}
