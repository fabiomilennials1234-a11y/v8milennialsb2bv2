DO $$
DECLARE
  baseline _ensaio674_p3t_rollback%ROWTYPE;
  current_def text;
  current_comment text;
  current_state text;
  current_trigger text;
BEGIN
  SELECT * INTO baseline FROM _ensaio674_p3t_rollback;

  SELECT pg_get_functiondef(p.oid),
         obj_description(p.oid, 'pg_proc'),
         COALESCE(p.proacl::text, '<null>') || '|' || p.prosecdef::text || '|' || COALESCE(p.proconfig::text, '<null>')
    INTO current_def, current_comment, current_state
  FROM pg_proc p
  WHERE p.oid = 'public.sync_responsible_from_lead_to_pipes()'::regprocedure;

  SELECT t.tgenabled::text || '|' || pg_get_triggerdef(t.oid, true)
    INTO current_trigger
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.leads'::regclass
    AND t.tgname = 'trg_sync_responsible_from_lead_to_pipes'
    AND NOT t.tgisinternal;

  IF current_def IS DISTINCT FROM baseline.function_def
     OR current_comment IS DISTINCT FROM baseline.function_comment
     OR current_state IS DISTINCT FROM baseline.function_state
     OR current_trigger IS DISTINCT FROM baseline.trigger_state THEN
    RAISE EXCEPTION 'REPROVOU: rollback não restaurou corpo/comentário/ACL/trigger';
  END IF;

  RAISE NOTICE 'ENSAIO_OK SCRUM-674 rollback janela 2: corpo, comentário, ACL e trigger restaurados';
END;
$$;

ROLLBACK;

