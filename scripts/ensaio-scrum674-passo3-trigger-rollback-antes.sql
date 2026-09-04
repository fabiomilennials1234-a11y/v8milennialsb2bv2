-- Baseline do rollback da janela 2. Nunca rodar sozinho.
BEGIN;

CREATE TEMP TABLE _ensaio674_p3t_rollback (
  function_def text NOT NULL,
  function_comment text,
  function_state text NOT NULL,
  trigger_state text NOT NULL
) ON COMMIT DROP;

INSERT INTO _ensaio674_p3t_rollback
SELECT pg_get_functiondef(p.oid),
       obj_description(p.oid, 'pg_proc'),
       COALESCE(p.proacl::text, '<null>') || '|' || p.prosecdef::text || '|' || COALESCE(p.proconfig::text, '<null>'),
       (
         SELECT t.tgenabled::text || '|' || pg_get_triggerdef(t.oid, true)
         FROM pg_trigger t
         WHERE t.tgrelid = 'public.leads'::regclass
           AND t.tgname = 'trg_sync_responsible_from_lead_to_pipes'
           AND NOT t.tgisinternal
       )
FROM pg_proc p
WHERE p.oid = 'public.sync_responsible_from_lead_to_pipes()'::regprocedure;

