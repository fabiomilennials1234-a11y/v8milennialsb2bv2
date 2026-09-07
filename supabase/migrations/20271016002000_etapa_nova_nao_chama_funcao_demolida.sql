-- Corrige o resíduo da demolição dos espelhos (20271015000000).
--
-- `system_stage_role(text,text)` foi removida porque `stage_role` passou a ser
-- dado explícito da etapa. O trigger BEFORE INSERT, porém, continuou chamando
-- a função removida por meio de `pipeline_stages_assign_system_stage_role()`.
-- Resultado em produção: qualquer etapa nova falhava; criar um funil falhava
-- atomicamente ao tentar criar sua primeira etapa.
--
-- A coluna já é NOT NULL DEFAULT 'open' e as portas canônicas
-- `fn_etapa_custom_criar` / seeds escrevem o papel explicitamente. Portanto o
-- reparo correto é remover o trigger e a função de trigger órfãos.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
DECLARE
  v_default text;
  v_not_null boolean;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid), a.attnotnull
    INTO v_default, v_not_null
    FROM pg_attribute a
    JOIN pg_attrdef d
      ON d.adrelid = a.attrelid
     AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.pipeline_stages'::regclass
     AND a.attname = 'stage_role'
     AND NOT a.attisdropped;

  IF v_default IS NULL OR v_default NOT LIKE '%open%' OR v_not_null IS NOT TRUE THEN
    RAISE EXCEPTION
      'stage_role sem DEFAULT open/NOT NULL; remover o trigger deixaria etapa sem papel (default=%, not_null=%)',
      v_default, v_not_null;
  END IF;
END
$precondition$;

DROP TRIGGER IF EXISTS trg_pipeline_stages_system_stage_role
  ON public.pipeline_stages;
DROP FUNCTION IF EXISTS public.pipeline_stages_assign_system_stage_role();

DO $postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.pipeline_stages'::regclass
       AND tgname = 'trg_pipeline_stages_system_stage_role'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trigger órfão trg_pipeline_stages_system_stage_role ainda existe';
  END IF;

  IF to_regprocedure('public.pipeline_stages_assign_system_stage_role()') IS NOT NULL
     OR to_regprocedure('public.system_stage_role(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'funções demolidas de stage_role ainda existem';
  END IF;
END
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
