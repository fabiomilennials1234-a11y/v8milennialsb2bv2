import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Escrita de `deal_items` — os produtos do negócio.
 *
 * ── POR QUE ISTO PRECISOU SER ESCRITO DE NOVO ─────────────────────────────
 * `deal_items` existe desde a Wave 1 e, quando este arquivo nasceu, **o repo
 * inteiro não tinha um único escritor dela**: os hooks `useCreateDealItem` /
 * `useUpdateDealItem` / `useDeleteDealItem` viviam em
 * `carteira/hooks/useDealItems.ts` e saíram junto com a rota `/negocios`
 * (ADR-0023 decisão 5) — removidos por serem órfãos, não por defeito. O
 * `CLAUDE.md` da carteira ainda os anuncia como API pública; o barril não.
 *
 * O bloco "Produtos e Valores" do painel também já desenhava o botão
 * "+ Adicionar produto" e nunca o mostrava, porque `DealCardPanel` não passava
 * o `onAdicionarProduto`. Havia desenho e tabela; faltava exatamente isto.
 *
 * ── O QUE O BANCO CALCULA, E QUE NÃO PODE SER MANDADO ─────────────────────
 * `deal_items.total` é coluna **GENERATED ALWAYS AS
 * ((quantity * unit_price) * (1 - discount_percent/100)) STORED** — mandá-la
 * num INSERT devolve erro `428C9`. Por isso o payload leva quantidade, preço e
 * desconto, e lê o total de volta.
 *
 * ── E O QUE UM TRIGGER REESCREVE PELAS COSTAS ─────────────────────────────
 * `trg_deal_items_sync_value` roda AFTER INSERT/UPDATE/DELETE e faz
 * `UPDATE deals SET value = SUM(deal_items.total)`. Ele é SECURITY DEFINER, o
 * que tem duas consequências práticas:
 *   1. quem lança item **não precisa** de permissão de UPDATE em `deals`;
 *   2. escrever `deals.value` aqui seria apagado no mesmo comando.
 * Nunca somar nada em `deals.value` a partir deste caminho.
 *
 * ── PERMISSÃO ─────────────────────────────────────────────────────────────
 * A policy é `"Users manage deal items"`, sem cláusula FOR (portanto ALL) e sem
 * checagem de papel: basta a linha ser da org de quem escreve. Ou seja, membro
 * comum lança produto — o gate é de tenant, não de cargo.
 */

export interface ItemNovoDoNegocio {
  dealId: string;
  /** `products.id` quando veio do catálogo; `null` no produto avulso. */
  productId: string | null;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  /** Percentual, 0–100. O banco tem CHECK e recusa fora da faixa. */
  descontoPercent?: number;
}

export function useAdicionarItemDoNegocio(entryId: string | null) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (item: ItemNovoDoNegocio) => {
      if (!organizationId) {
        throw new Error("Organização não resolvida — recarregue a página.");
      }

      const { data, error } = await supabase
        .from("deal_items")
        .insert({
          deal_id: item.dealId,
          organization_id: organizationId,
          // `product_name` é NOT NULL e é ele que a tela lê. O `product_id` é
          // opcional de propósito: é o que separa item de catálogo de item
          // avulso — e só o de catálogo alimenta `lead_products` quando o
          // negócio for ganho (trigger `trg_deal_won_lead_products`).
          product_id: item.productId,
          product_name: item.nome,
          quantity: item.quantidade,
          unit_price: item.precoUnitario,
          discount_percent: item.descontoPercent ?? 0,
        })
        .select("id, product_name, quantity, unit_price, total")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      /**
       * Uma invalidação só, e ela acerta os DOIS números.
       *
       * O "Total" do bloco e o ladrilho "Valor Total" do topo saem da mesma
       * `contaDoNegocio()` sobre `negocio.itens`, que vem desta query. Invalidar
       * a chave do painel recarrega os itens e os dois se corrigem juntos —
       * sem segunda conta, que é como eles começariam a divergir.
       *
       * A chave completa é `["deal-card-extras", entryId, pipelineId, stageKey]`;
       * o prefixo casa por posição e cobre qualquer etapa.
       */
      queryClient.invalidateQueries({ queryKey: ["deal-card-extras", entryId] });
      // `deals.value` mudou por trigger; quem lê negócio pela lista precisa saber.
      queryClient.invalidateQueries({ queryKey: ["leads-deals"] });
    },
    onError: (erro: Error) => {
      toast.error(`Não foi possível lançar o produto: ${erro.message}`);
    },
  });
}
