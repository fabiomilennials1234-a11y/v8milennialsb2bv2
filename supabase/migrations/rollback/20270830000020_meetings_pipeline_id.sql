-- ROLLBACK de 20270830000020_meetings_pipeline_id.sql
--
-- Devolve `meetings` ao estado anterior: sem `pipeline_id`, sem a FK e sem o
-- índice.
--
-- 🚨 DESTRUTIVO PARA O VÍNCULO JÁ GRAVADO. Dropar a coluna APAGA o funil de
-- toda reunião que já tiver um. O lead sobrevive (`meetings.lead_id` é outra
-- coluna e não é tocada aqui), mas "de qual funil este lead veio" some, e não
-- há de onde reconstruir — a derivação a partir de `pipeline_entries` é
-- justamente o que a migration recusou por ser um chute (lead em vários funis;
-- sair do funil é DELETE físico).
--
-- Antes de rodar, meça o que se perde:
--   SELECT count(*) FROM public.meetings WHERE pipeline_id IS NOT NULL;
--
-- ⚠️ Rodar isto com o front novo no ar quebra a criação E a edição de reunião
-- (o INSERT/UPDATE passa a mandar coluna inexistente → PGRST204). Reverta o
-- front antes, ou junto.

BEGIN;

DROP INDEX IF EXISTS public.idx_meetings_org_pipeline;

ALTER TABLE public.meetings
  DROP CONSTRAINT IF EXISTS meetings_pipeline_id_fkey;

ALTER TABLE public.meetings
  DROP COLUMN IF EXISTS pipeline_id;

-- Gabarito.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meetings'
      AND column_name = 'pipeline_id')            AS coluna_restante_esperado_0,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'meetings_pipeline_id_fkey')  AS fk_restante_esperado_0,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_meetings_org_pipeline') AS indice_restante_esperado_0;

COMMIT;
