-- ROLLBACK de 20270301000020_pipeline_stages_stage_role.sql (issue #990)
--
-- Remove trigger, funções, coluna e tipo — na ordem inversa da criação.
-- ATENÇÃO: DROP COLUMN descarta os roles atribuídos (backfill é
-- re-executável: basta reaplicar a migration — o mapa é determinístico,
-- nenhum dado além do derivável se perde, EXCETO roles atribuídos
-- manualmente/pelo classifier depois desta migration).

BEGIN;

DROP TRIGGER IF EXISTS trg_pipeline_stages_system_stage_role
  ON public.pipeline_stages;

DROP FUNCTION IF EXISTS public.pipeline_stages_assign_system_stage_role();

ALTER TABLE public.pipeline_stages
  DROP COLUMN IF EXISTS stage_role;

DROP FUNCTION IF EXISTS public.system_stage_role(text, text);

DROP TYPE IF EXISTS public.stage_role;

COMMIT;
