-- 20270908010000_metricas_de_produto_leem_deal_items.sql
--
-- A quebra POR PRODUTO passa a ler `deal_items` — o caderno onde o painel do
-- Negócio escreve — em vez de ler só `pipe_proposta_items`.
--
-- O DEFEITO, MEDIDO
--
-- Havia ZERO caminho de LEITURA sobre `deal_items` (medido em prod 2026-09-02,
-- `pg_proc`): as 5 funções que a citavam eram todas de ESCRITA (as 3 RPCs
-- `deal_item_lancar/atualizar/remover` e os 2 gatilhos). As métricas de produto
-- — `get_product_ranking` e `_metric_leaf_curva_abc` — liam o OUTRO caderno.
--
-- Dois cadernos paralelos, e a métrica lia o que a tela nova não escreve. O
-- sintoma para o cliente: "Produtos campeões" imprimindo *"Nenhuma venda com
-- produto no período"* havendo venda real lançada pelo painel do Negócio.
--
-- POR QUE NÃO É UM `UNION` DOS DOIS CADERNOS
--
-- 🚨 Somar os dois DOBRARIA. O backfill da unificação de funis (2026-09-02
-- 05:08) materializou 625 itens em `deal_items` a partir das mesmas entradas
-- que já estavam em `pipe_proposta_items` — os dois cadernos são hoje quase
-- espelhos (medido: `deal_items` tem valor >= `pipe_proposta_items` nas 9 orgs
-- que têm item). Um `UNION ALL` contaria a mesma venda duas vezes.
--
-- POR QUE TAMBÉM NÃO É "SÓ `deal_items`"
--
-- 🚨 `pipe_proposta_items` AINDA RECEBE ESCRITA de três telas vivas —
-- `CreateProposalModal.tsx`, `BudgetFieldBlock.tsx` (o bloco Orçamento) e
-- `PropostasContext.tsx` — e NÃO existe gatilho sincronizando os cadernos
-- (medido: `pg_trigger` em `pipe_proposta_items` = zero linhas; o backfill foi
-- tiro único). Ler só o caderno novo trocaria o ponto cego de lado: o item
-- lançado pelo Orçamento passaria a sumir do ranking. Última escrita em
-- `pipe_proposta_items`: 2026-08-19, 14 linhas nos 30 dias anteriores. Está
-- esfriando, não está morto.
--
-- O DESENHO: PREFERÊNCIA POR ENTRADA, NÃO UNIÃO
--
-- Para cada entrada de funil, os itens vêm de `deal_items` do Negócio dela; e
-- SÓ quando aquele Negócio não tem item nenhum lá, caem para
-- `pipe_proposta_items`. Uma entrada nunca contribui pelos dois caminhos, então
-- não dobra — e o caderno novo é quem manda onde ele tem dado.
--
-- Isso torna a mudança segura nos dois sentidos do tempo: hoje os números não
-- se mexem, e amanhã tanto o item do painel do Negócio quanto o do Orçamento
-- aparecem.
--
-- EQUIVALÊNCIA — MEDIDA, NÃO AFIRMADA
--
-- Rodado em prod 2026-09-02, velho × novo, por org, para as duas funções
-- (contagem de produtos DISTINTOS e soma de valor). Bateu exato nas 7 orgs que
-- têm venda com produto:
--
--   org             produtos      valor        bate
--   Milennials         8 = 8    406.362,00 = 406.362,00   sim
--   Basic4u           26 = 26    61.852,88 =  61.852,88   sim
--   Improving          1 = 1     55.270,00 =  55.270,00   sim
--   Happyneis          8 = 8     14.220,00 =  14.220,00   sim
--   Barulinho Bom      4 = 4      4.501,14 =   4.501,14   sim
--   Distetica          7 = 7      1.455,28 =   1.455,28   sim
--   Drink Express      1 = 1        952,00 =     952,00   sim
--
-- 🚨 A PRIMEIRA TENTATIVA REGREDIA, E SÓ A MEDIÇÃO PEGOU
--
-- A tradução "óbvia" seria trocar `pp.status = 'vendido'` por
-- `deals.outcome = 'won'`. Ela ZERAVA a Basic4u — 26 produtos e R$ 61.852,88
-- viravam 0 — porque 35 dos 36 Negócios materializados dela estão numa etapa
-- com `is_final_positive = true` mas com `outcome = 'open'` e `won = NULL`.
--
-- `pp.status` é a ETAPA DA ENTRADA, não o desfecho do Negócio. Trocar uma pela
-- outra teria mudado a definição de "vendido" em silêncio. Por isso o filtro de
-- venda continua exatamente onde estava; só a fonte dos ITENS muda.
--
-- ⚠ O desalinhamento etapa-de-ganho × `outcome` é MAIOR que a Basic4u e é
-- anterior a esta migration: 888 Negócios em 37 orgs estão em etapa
-- `is_final_positive` com `outcome <> 'won'` (708 com `source='backfill'`, 35
-- `entrada_materializada`, 145 de outras procedências). Item próprio — esta
-- migration não o conserta, ela apenas não pisa nele.
--
-- O QUE ESTA MIGRATION NÃO TOCA, DE PROPÓSITO
--
-- 🔴 `get_dashboard_metrics` também lê `pipe_proposta_items`, e continua lendo.
-- Lá os itens não alimentam só uma quebra: alimentam `v_venda_total`, a RECEITA
-- do painel principal. Trocar a fonte dela move dinheiro na tela mais vista do
-- produto e merece fatia própria, com a sua própria medição de equivalência.
-- As outras três que citam `pipe_proposta_items` — `delete_pipeline`,
-- `handle_proposta_vendida`, `purge_lead` — são manutenção, não métrica.
--
-- 🔴 Os itens "avulso" (texto livre, `product_id IS NULL`) seguem FORA do
-- ranking: o `JOIN products` continua sendo INNER, como era. São 6 de 631
-- (0,95%) em prod — decisão do Lucas em 2026-09-02. Agrupá-los exigiria
-- normalizar nome digitado à mão.

-- ─── Ranking de produtos (card "Produtos campeões") ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_ranking(
  p_org_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  SELECT COALESCE(jsonb_agg(row_to_json(ranked) ORDER BY ranked.total_value DESC), '[]'::jsonb)
  INTO result
  FROM (
    SELECT p.id AS product_id, p.name AS product_name, p.type AS product_type,
      COUNT(DISTINCT pp.id) AS qty_sold,
      SUM(it.valor) AS total_value,
      CASE WHEN COUNT(DISTINCT pp.id) > 0
        THEN ROUND(SUM(it.valor) / COUNT(DISTINCT pp.id), 2) ELSE 0 END AS ticket_medio
    FROM pipe_propostas pp
    JOIN pipeline_entries pe ON pe.id = pp.id
    LEFT JOIN deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
    -- Preferência por entrada: o caderno do Negócio manda; o antigo só cobre
    -- a entrada cujo Negócio não tem item nenhum. Nunca os dois.
    CROSS JOIN LATERAL (
      SELECT di.product_id, di.total AS valor
      FROM deal_items di
      WHERE di.deal_id = d.id
      UNION ALL
      SELECT ppi.product_id, COALESCE(ppi.sale_value, 0)
      FROM pipe_proposta_items ppi
      WHERE ppi.pipe_proposta_id = pp.id
        AND NOT EXISTS (SELECT 1 FROM deal_items di2 WHERE di2.deal_id = d.id)
    ) it
    JOIN products p ON p.id = it.product_id
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
    GROUP BY p.id, p.name, p.type ORDER BY total_value DESC LIMIT 10
  ) ranked;
  RETURN result;
END; $function$;

-- ─── Curva ABC (Estúdio de Métricas) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._metric_leaf_curva_abc(
  p_org_id uuid,
  p_recorte text,
  p_bounds tstzrange,
  p_tz text,
  p_filters jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_series jsonb;
  v_base bigint;
BEGIN
  IF p_recorte <> 'produto' THEN
    RAISE EXCEPTION 'recorte % incompatible with measure curva_abc', p_recorte
      USING ERRCODE = '22023';
  END IF;

  -- `v_base` responde "houve linha na janela?" para distinguir "zero vendas" de
  -- "vendas sem produto". Conta pela mesma preferência da série, senão a org
  -- que só tem item no caderno novo leria `empty_reason = 'no_rows'` tendo dado.
  SELECT count(*) INTO v_base
  FROM public.pipeline_entries pe
  LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
  CROSS JOIN LATERAL (
    SELECT di.id
    FROM public.deal_items di
    WHERE di.deal_id = d.id
    UNION ALL
    SELECT ppi.id
    FROM public.pipe_proposta_items ppi
    WHERE ppi.pipe_proposta_id = pe.id
      AND NOT EXISTS (SELECT 1 FROM public.deal_items di2 WHERE di2.deal_id = d.id)
  ) it
  WHERE pe.organization_id = p_org_id
    AND pe.stage_key = 'vendido'
    AND COALESCE(pe.closed_at, pe.entered_at) <@ p_bounds;

  WITH por_produto AS (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(it.valor) AS receita
    FROM public.pipeline_entries pe
    LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.deleted_at IS NULL
    CROSS JOIN LATERAL (
      SELECT di.product_id, di.total AS valor
      FROM public.deal_items di
      WHERE di.deal_id = d.id
      UNION ALL
      SELECT ppi.product_id, COALESCE(ppi.sale_value, 0)
      FROM public.pipe_proposta_items ppi
      WHERE ppi.pipe_proposta_id = pe.id
        AND NOT EXISTS (SELECT 1 FROM public.deal_items di2 WHERE di2.deal_id = d.id)
    ) it
    JOIN public.products p ON p.id = it.product_id
    WHERE pe.organization_id = p_org_id
      AND pe.stage_key = 'vendido'
      AND COALESCE(pe.closed_at, pe.entered_at) <@ p_bounds
      AND ((p_filters->>'product_id') IS NULL OR p.id = (p_filters->>'product_id')::uuid)
    GROUP BY p.id, p.name
    HAVING SUM(it.valor) > 0
  ),
  acumulado AS (
    SELECT
      product_id, product_name, receita,
      -- Acumulado APÓS incluir este produto. É o que faz o produto que cruza a
      -- fronteira pertencer à classe de cima.
      SUM(receita) OVER (ORDER BY receita DESC, product_name)
        / NULLIF(SUM(receita) OVER (), 0) AS fracao
    FROM por_produto
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', a.product_id,
           'label', a.classe || ' · ' || a.product_name,
           'value', a.receita
         ) ORDER BY a.receita DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      product_id, product_name, receita,
      CASE
        WHEN fracao <= 0.80 THEN 'A'
        WHEN fracao <= 0.95 THEN 'B'
        ELSE 'C'
      END AS classe
    FROM acumulado
  ) a;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
END;
$function$;
