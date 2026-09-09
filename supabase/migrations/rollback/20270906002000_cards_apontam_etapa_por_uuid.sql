-- rollback/20270906002000_cards_apontam_etapa_por_uuid.sql
--
-- Reverte SCRUM-617: derruba espelho (trigger + função), índice, FK e a coluna
-- pipeline_entries.stage_id. Nenhum dado de negócio se perde — stage_key nunca
-- deixou de ser escrito (o espelho é aditivo).
--
-- PERDA CONHECIDA E ACEITA (D-c da migration): o reparo dos 16 cards custom cujo
-- stage_key guardava o UUID da etapa normalizou o stage_key para a key real.
-- O rollback NÃO devolve o uuid cru — é correção de dado (cards invisíveis no
-- kanban), não regressão; reverter a correção seria reintroduzir o bug.
--
-- ATENÇÃO: reverter esta migration sozinha é seguro (nenhum escritor de
-- stage_id existe no W1). Se a 20270906001000 (SCRUM-616) também for revertida,
-- reverter ESTA PRIMEIRO — a 001000 não pode derrubar pipeline_stages enquanto
-- a FK pipeline_entries_stage_id_fkey apontar para ela.
--
-- metric-lint-allow: rollback one-off de backfill de FK (SCRUM-617) — não é métrica

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- Guarda: só roda por cima do estado pós-migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pipeline_entries'
                    AND column_name = 'stage_id') THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM617: pipeline_entries.stage_id não existe — migration não aplicada?';
  END IF;
END;
$$;

-- 1. Espelho cai primeiro (nenhuma escrita fica sem resolver no meio do rollback).
DROP TRIGGER IF EXISTS trg_pe_stage_mirror ON public.pipeline_entries;
DROP FUNCTION IF EXISTS public.pipeline_entries_stage_mirror();

-- 2. Índice, FK e coluna.
DROP INDEX IF EXISTS public.idx_pipeline_entries_stage_id;
ALTER TABLE public.pipeline_entries
  DROP CONSTRAINT IF EXISTS pipeline_entries_stage_id_fkey;
ALTER TABLE public.pipeline_entries
  DROP COLUMN stage_id;

-- 3. Asserções do rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pipeline_entries'
                AND column_name = 'stage_id') THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM617: coluna stage_id ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'pipeline_entries_stage_mirror') THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM617: função do espelho ainda existe';
  END IF;
  RAISE NOTICE 'ROLLBACK SCRUM617 OK: stage_id, FK, índice e espelho removidos (stage_key intacto)';
END;
$$;
