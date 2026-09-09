BEGIN;

CREATE TEMP TABLE _ensaio673_rollback (
  trigger_defs jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO _ensaio673_rollback
SELECT jsonb_object_agg(proname, pg_get_functiondef(oid) ORDER BY proname)
FROM pg_proc
WHERE oid IN (
  'public.custom_pipelines_insert_fn()'::regprocedure,
  'public.custom_pipelines_update_fn()'::regprocedure,
  'public.custom_pipeline_stages_insert_fn()'::regprocedure,
  'public.custom_pipeline_stages_update_fn()'::regprocedure
);
