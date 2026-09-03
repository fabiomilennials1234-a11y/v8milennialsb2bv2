-- ROLLBACK de 20270917000000_campanha_e_disparo_por_pipeline_id.sql (Fatia B)
--
-- Desfaz SÓ o que a migration fez:
--   · derruba as colunas canônicas novas (campanhas.target_pipeline_id/
--     target_stage_id, blast_plans.pipeline_id) — as FKs caem junto;
--   · remove dos JSONB de blast_plans APENAS as chaves que o backfill one-shot
--     acrescentou, identificadas pelo marcador 'backfilled_pipeline_id'.
--     Descriptors que já nasciam com pipelineId (escrita custom legada) não
--     carregam o marcador e ficam intactos.

BEGIN;

UPDATE public.blast_plans
   SET source = (source - 'pipelineId') - 'backfilled_pipeline_id'
 WHERE source ? 'backfilled_pipeline_id';

UPDATE public.blast_plans
   SET post_send_target = (post_send_target - 'pipelineId') - 'backfilled_pipeline_id'
 WHERE post_send_target ? 'backfilled_pipeline_id';

ALTER TABLE public.blast_plans DROP COLUMN IF EXISTS pipeline_id;

ALTER TABLE public.campanhas
  DROP COLUMN IF EXISTS target_stage_id,
  DROP COLUMN IF EXISTS target_pipeline_id;

COMMIT;
