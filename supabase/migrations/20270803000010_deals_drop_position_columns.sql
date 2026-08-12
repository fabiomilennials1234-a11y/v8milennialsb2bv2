-- ============================================================================
-- M3b — `deals` para de carregar posição. Passo 4 do L2 (fatia 2, lead-negocio).
--
-- ADR-0023 decisão 5: a posição do Negócio vive em `pipeline_entries` (uma linha
-- por negócio, e essa linha VIAJA entre funis); `deals` carrega identidade e
-- dinheiro. Com a decisão 4 — avançar é MOVER, não copiar — manter
-- `deals.pipeline_id` e `deals.stage_id` seria reintroduzir a segunda verdade
-- que a decisão existe para matar.
--
-- ── PRÉ-REQUISITO, e ele é de CÓDIGO, não de banco ─────────────────────────
-- Esta migration só é segura depois que o passo 3 apagou a rota `/negocios`.
-- Medido em 2026-08-03, varrendo src/, supabase/functions/, supabase/migrations/
-- e tests/:
--
--   • `deals.stage_id`    — lido em `Negocios.tsx:111` e **ESCRITO** em `:144`
--   • `deals.pipeline_id` — lido em `carteira/hooks/useDeals.ts:104`
--
-- ⚠️ Correção de registro: o ADR dizia que `/negocios` é "the only surface
-- reading deals.pipeline_id/stage_id". Na letra é falso — a página nunca lê
-- `pipeline_id`; quem lê é o hook. No efeito se sustenta, porque o hook tinha um
-- único importador (a própria página) e os dois foram apagados juntos no passo 3.
-- Fora daí: **zero** leitores em edge functions, testes, views, RPCs e triggers.
--
-- ── DEPENDENTES NO BANCO (medidos em prod, 2026-08-03) ─────────────────────
--   idx_deals_pipeline   INDEX ... (pipeline_id) WHERE pipeline_id IS NOT NULL
--   idx_deals_stage      INDEX ... (stage_id)    WHERE stage_id IS NOT NULL
--   deals_stage_id_fkey  FK (stage_id) → pipeline_stages(id) ON DELETE SET NULL
--
-- Os três caem sozinhos com o `DROP COLUMN`, porque dependem só da coluna.
-- **Sem `CASCADE` de propósito**: se algum dependente aparecer que não esteja
-- nesta lista — uma view, uma policy, uma constraint nova — queremos que o apply
-- FALHE e alguém leia, em vez de derrubar o objeto em silêncio. `pipeline_id`
-- nunca teve FK; nenhuma view depende de `deals`.
--
-- ── DADO ───────────────────────────────────────────────────────────────────
-- `deals` tem **0 linhas** em prod (medido 2026-08-03, e desde que a tabela
-- existe). Nenhum dado de cliente é lido, escrito ou perdido aqui — só schema
-- (guarda F4). O backfill que popula a tabela é o L3, e roda DEPOIS.
--
-- ⚠️ Ordem: esta migration é irreversível na prática. Não há como recuperar o
-- conteúdo das colunas depois do drop — mas como são 0 linhas, não há conteúdo.
-- Se o backfill do L3 já tiver rodado quando alguém aplicar isto, PARE: aí as
-- colunas podem ter valor, e o rollback vira perda.
-- ============================================================================

BEGIN;

-- Guarda: recusa rodar se a tabela deixou de estar vazia. Barato, e é a única
-- diferença entre "drop de coluna vazia" e "perda de dado de cliente".
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.deals
   WHERE pipeline_id IS NOT NULL OR stage_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: % linha(s) de `deals` têm pipeline_id ou stage_id preenchido. Esta migration assume 0 (medido em prod 2026-08-03). Se o backfill do L3 já rodou, revise o plano antes de dropar — o conteúdo não volta.', v_n;
  END IF;
END$$;

ALTER TABLE public.deals DROP COLUMN pipeline_id;
ALTER TABLE public.deals DROP COLUMN stage_id;

-- Verificação: as colunas sumiram, e os três dependentes foram junto.
DO $$
DECLARE v_cols int; v_idx int; v_fk int;
BEGIN
  SELECT count(*) INTO v_cols FROM pg_attribute
   WHERE attrelid = 'public.deals'::regclass
     AND attname IN ('pipeline_id','stage_id') AND NOT attisdropped;
  IF v_cols <> 0 THEN
    RAISE EXCEPTION 'FAIL: ainda existem % coluna(s) de posição em `deals`.', v_cols;
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='deals'
     AND indexname IN ('idx_deals_pipeline','idx_deals_stage');
  IF v_idx <> 0 THEN
    RAISE EXCEPTION 'FAIL: % índice(s) de posição sobreviveram ao drop.', v_idx;
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint
   WHERE conrelid='public.deals'::regclass AND conname = 'deals_stage_id_fkey';
  IF v_fk <> 0 THEN
    RAISE EXCEPTION 'FAIL: a FK deals_stage_id_fkey sobreviveu ao drop.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: deals.pipeline_id e deals.stage_id dropadas; idx_deals_pipeline, idx_deals_stage e deals_stage_id_fkey caíram junto. A posição do Negócio passa a viver só em pipeline_entries.';
END$$;

COMMIT;
