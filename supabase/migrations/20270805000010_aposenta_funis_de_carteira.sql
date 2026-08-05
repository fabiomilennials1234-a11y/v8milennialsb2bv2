-- ============================================================================
-- Aposenta os funis de Carteira. A Carteira vira faceta do Lead (ADR-0023 §8):
-- cliente é lead com Relação `Cliente`, e cada venda é um Negócio.
--
-- ── POR QUE ISTO É BARATO ─────────────────────────────────────────────────
-- Medido em prod 2026-08-04, antes de escrever:
--   • 1.078 etapas ativas de `upsell_base` / `upsell_gestao`, em 97 orgs;
--   • **0 entries** usando qualquer uma delas;
--   • 2 linhas em `pipelines` com slug `upsell*`, numa única org.
--
-- Foram configurados e nunca usados — mesmo padrão de `deals`, `activities` e
-- `lead_products`. Não há card para migrar, então não há dado de cliente em
-- risco.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ ──────────────────────────────────────────
-- Não apaga nada. Desativa. `upsell_clients` e `upsell_orders` continuam
-- intactos — eles são a FONTE das métricas da relação e a origem dos Negócios
-- ganhos que o backfill cria. O que morre é o funil, não a carteira.
--
-- Reverter é `is_active = true` nas mesmas linhas.
-- ============================================================================

BEGIN;

-- ── 1. As 4 transições que apontam para a carteira ────────────────────────
-- Etapa com `target_pipe_type` de carteira mandaria o negócio para um funil
-- aposentado. Limpar ANTES de desativar: com a etapa-destino inativa, a
-- transição vira ponteiro para o nada e o move falha em silêncio.
UPDATE public.pipeline_stages
   SET target_pipe_type = NULL,
       target_stage_key = NULL,
       is_final_positive = false
 WHERE is_active
   AND target_pipe_type::text LIKE 'upsell%';

-- ── 2. As etapas ──────────────────────────────────────────────────────────
UPDATE public.pipeline_stages
   SET is_active = false
 WHERE pipeline_type IN ('upsell_base', 'upsell_gestao');

-- ── 3. As linhas de funil ─────────────────────────────────────────────────
UPDATE public.pipelines
   SET is_active = false
 WHERE slug LIKE 'upsell%';

-- ── Prova ─────────────────────────────────────────────────────────────────
-- Levanta exceção e desfaz a transação se sobrar qualquer resquício ativo, ou
-- se — contra a medição — existir card num funil de carteira.
DO $$
DECLARE
  v_etapas int;
  v_funis int;
  v_transicoes int;
  v_cards int;
BEGIN
  SELECT count(*) INTO v_etapas FROM public.pipeline_stages
   WHERE pipeline_type IN ('upsell_base','upsell_gestao') AND is_active;
  IF v_etapas <> 0 THEN
    RAISE EXCEPTION 'FALHA: % etapa(s) de carteira seguem ativas', v_etapas;
  END IF;

  SELECT count(*) INTO v_funis FROM public.pipelines
   WHERE slug LIKE 'upsell%' AND is_active;
  IF v_funis <> 0 THEN
    RAISE EXCEPTION 'FALHA: % funil(is) de carteira seguem ativos', v_funis;
  END IF;

  SELECT count(*) INTO v_transicoes FROM public.pipeline_stages
   WHERE is_active AND target_pipe_type::text LIKE 'upsell%';
  IF v_transicoes <> 0 THEN
    RAISE EXCEPTION 'FALHA: % transição(ões) ainda apontam para a carteira', v_transicoes;
  END IF;

  SELECT count(*) INTO v_cards
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
   WHERE p.slug LIKE 'upsell%';
  IF v_cards <> 0 THEN
    RAISE EXCEPTION 'FALHA: % card(s) em funil de carteira — a medição dizia 0. NÃO aposentar.', v_cards;
  END IF;

  RAISE NOTICE 'OK: funis de carteira aposentados. upsell_clients e upsell_orders intactos.';
END $$;

COMMIT;
