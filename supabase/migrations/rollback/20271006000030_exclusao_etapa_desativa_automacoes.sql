-- Rollback de 20271006000030_exclusao_etapa_desativa_automacoes.sql

DROP FUNCTION IF EXISTS public.delete_pipeline_stage(uuid, uuid);
DROP FUNCTION IF EXISTS public.pipeline_stage_delete_impact(uuid);
