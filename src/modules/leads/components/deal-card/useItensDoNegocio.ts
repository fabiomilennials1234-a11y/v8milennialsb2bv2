import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

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
 * ── POR QUE AS TRÊS PASSAM POR RPC, E NÃO PELA TABELA ─────────────────────
 * O INSERT cru que existia aqui antes funcionava, e mesmo assim deixava três
 * buracos que a RLS **não** fecha. A policy `"Users manage deal items"` é
 * `FOR ALL` com `organization_id IN (SELECT get_my_organization_ids())` no
 * USING e no WITH CHECK: ela prova que a LINHA é de uma org minha, e nada
 * além disso.
 *
 *   1. **`deal_id` não era checado.** Dava para gravar um item com a minha org
 *      apontando para o negócio de outra — e como `fn_sync_deal_value_from_items`
 *      é SECURITY DEFINER e atualiza `deals` só por `id`, o valor daquele outro
 *      negócio seria reescrito. Na RPC a org é **derivada do negócio**.
 *   2. **`product_id` não era checado.** Dava para pendurar produto de outra
 *      organização num negócio meu. É literalmente o "não permitir selecionar
 *      produtos de outra organização" do pedido, e o único lugar onde isso se
 *      garante é no banco: o front pode ser contornado.
 *   3. **quantidade, preço e desconto** chegavam crus do navegador. Os CHECKs
 *      da tabela pegam o absurdo, mas devolvem `23514` sem contexto — e
 *      "quantidade 0" precisava virar uma frase, não um código.
 *
 * As três RPCs são **SECURITY INVOKER**: a permissão continua sendo a mesma
 * RLS de antes (basta ser membro ativo da org — `deal_items` não tem checagem
 * de cargo, e não é esta mudança que vai inventar uma). O que mudou é que o
 * ESCOPO deixou de ser escolhido por quem chama.
 *
 * `as never` no nome das RPCs: elas ainda não estão em
 * `integrations/supabase/types.ts`, que é gerado e só é regenerado depois do
 * apply em prod — mesmo precedente de `abrir_negocio`
 * (`useLeadAllPipelines.ts:368`).
 *
 * ── O QUE O BANCO CALCULA, E QUE NÃO PODE SER MANDADO ─────────────────────
 * `deal_items.total` é coluna **GENERATED ALWAYS AS
 * ((quantity * unit_price) * (1 - discount_percent/100)) STORED** — mandá-la
 * num INSERT ou UPDATE devolve erro `428C9`. Por isso o payload leva
 * quantidade, preço e desconto, e o total volta pronto.
 *
 * ── E O QUE UM TRIGGER REESCREVE PELAS COSTAS ─────────────────────────────
 * `trg_deal_items_sync_value` roda AFTER INSERT/UPDATE/DELETE e faz
 * `UPDATE deals SET value = SUM(deal_items.total)`. É por isso que **nenhuma**
 * destas três funções escreve `deals.value`: seria apagado no mesmo comando.
 * Vale para as três, inclusive a de remover — tirar o último item leva
 * `deals.value` a 0 sozinho.
 */

/** A chave do painel. Uma invalidação dela acerta a lista, o Total e o ladrilho. */
function invalidarNegocio(
  queryClient: ReturnType<typeof useQueryClient>,
  entryId: string | null,
) {
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
}

export interface ItemNovoDoNegocio {
  dealId: string;
  /** `products.id` quando veio do catálogo; `null` no produto avulso. */
  productId: string | null;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  /** Percentual, 0–100. A RPC recusa fora da faixa com mensagem legível. */
  descontoPercent?: number;
}

/**
 * Lançar produto.
 *
 * ── A REGRA DE DUPLICADO É "CONSOLIDA", E ELA MORA NO BANCO ───────────────
 * Lançar o mesmo produto duas vezes **soma na linha que já existe** em vez de
 * criar uma segunda. Não é preferência de layout: dois itens com o mesmo
 * `product_id` no mesmo negócio faziam o `ON CONFLICT` de
 * `fn_deal_won_populate_lead_products` estourar `21000` e **derrubar o UPDATE
 * que marca `won = true`** — o negócio não era ganho, e a mensagem na tela não
 * falava de produto nenhum.
 *
 * A consolidação vive na RPC (com `FOR UPDATE`) e não aqui, porque duas abas
 * lançando ao mesmo tempo passariam por duas checagens de front e criariam as
 * duas linhas assim mesmo.
 */
export function useAdicionarItemDoNegocio(entryId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: ItemNovoDoNegocio) => {
      const { data, error } = await supabase.rpc("deal_item_lancar" as never, {
        p_deal_id: item.dealId,
        // `product_id` opcional é o que separa item de catálogo de item avulso
        // — e só o de catálogo alimenta `lead_products` quando o negócio for
        // ganho (trigger `trg_deal_won_lead_products`).
        p_product_id: item.productId,
        p_product_name: item.nome,
        p_quantity: item.quantidade,
        p_unit_price: item.precoUnitario,
        p_discount_percent: item.descontoPercent ?? 0,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => invalidarNegocio(queryClient, entryId),
    onError: (erro: Error) => {
      toast.error(`Não foi possível lançar o produto: ${erro.message}`);
    },
  });
}

export interface ItemEditadoDoNegocio {
  itemId: string;
  quantidade: number;
  precoUnitario: number;
  descontoPercent?: number;
}

/**
 * Editar quantidade, preço unitário ou desconto de um item já lançado.
 *
 * ⚠ **Quantidade 0 não é "remover".** A tabela tem `CHECK (quantity > 0)` e
 * devolveria `23514` cru; a RPC troca isso por uma frase que manda usar o
 * Remover. As duas ações precisam continuar distintas para quem usa — "zerei a
 * quantidade" e "tirei o produto da proposta" são decisões diferentes.
 */
export function useAtualizarItemDoNegocio(entryId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: ItemEditadoDoNegocio) => {
      const { data, error } = await supabase.rpc("deal_item_atualizar" as never, {
        p_item_id: item.itemId,
        p_quantity: item.quantidade,
        p_unit_price: item.precoUnitario,
        p_discount_percent: item.descontoPercent ?? 0,
      } as never);

      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidarNegocio(queryClient, entryId),
    onError: (erro: Error) => {
      toast.error(`Não foi possível salvar o produto: ${erro.message}`);
    },
  });
}

/**
 * Materializar o Negócio da entrada — o que destrava lançar produto no card
 * que ainda não tem um.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 * `deal_items.deal_id` é NOT NULL, então card sem `deals` não tinha onde
 * pendurar item — e o painel escondia o "+ Adicionar produto" e imprimia
 * *"Este card ainda não tem um negócio aberto"*. Medido em prod: **9.258 de
 * 48.138 entradas (19,2%)** estavam nesse estado, concentradas em funil de
 * SISTEMA (9.084; nos custom eram só 174). Para quem usa, o produto
 * simplesmente não existia naquele card.
 *
 * ── POR QUE NÃO VIOLA A ADR-0023 ──────────────────────────────────────────
 * A decisão 3 diz que "um Negócio nasce só por clique humano" e proíbe
 * ingest, integração e automação — **é exatamente o que continua valendo**:
 * quem cria aqui é a pessoa clicando em "+ Adicionar produto", com intenção
 * explícita. Nada nasce por chegada de lead, por webhook ou por progresso de
 * etapa (a criação dirigida por `compareceu` que a ADR rejeita).
 *
 * ⚠ O comentário anterior no `DealCardPanel` dizia que ligar entrada antiga a
 * negócio seria "trabalho de RPC própria" e que a única porta era
 * `abrir_negocio` — que cria card NOVO. Isso **caducou**: a RPC própria passou
 * a existir em `20270904000000_desfecho_do_negocio.sql`, e é a mesma porta que
 * o backfill da `20270908005010` e o desfecho pela UI já usam.
 *
 * ── IDEMPOTENTE, E É ISSO QUE A TORNA SEGURA NO CLIQUE ────────────────────
 * `garantir_negocio_da_entrada` devolve o `deal_id` que já existe quando existe,
 * e só INSERE quando não há. Dois cliques seguidos, ou duas abas, não criam dois
 * Negócios. O que ela cria leva `source = 'entrada_materializada'`, o mesmo
 * rótulo do backfill — então dá para separar depois o que nasceu por aqui.
 */
export function useGarantirNegocioDaEntrada(entryId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("garantir_negocio_da_entrada" as never, {
        p_entry_id: id,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    // O painel precisa reler: o card passa a ter negócio, e é dele que saem o
    // bloco de produtos e o valor.
    onSuccess: () => invalidarNegocio(queryClient, entryId),
    onError: (erro: Error) => {
      toast.error(`Não foi possível abrir o negócio deste card: ${erro.message}`);
    },
  });
}

/** Remover um item do negócio. O valor do negócio se recalcula sozinho. */
export function useRemoverItemDoNegocio(entryId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data, error } = await supabase.rpc("deal_item_remover" as never, {
        p_item_id: itemId,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => invalidarNegocio(queryClient, entryId),
    onError: (erro: Error) => {
      toast.error(`Não foi possível remover o produto: ${erro.message}`);
    },
  });
}
