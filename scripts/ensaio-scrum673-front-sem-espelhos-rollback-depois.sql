DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT trigger_defs INTO v_before FROM _ensaio673_rollback;

  SELECT jsonb_object_agg(proname, pg_get_functiondef(oid) ORDER BY proname)
    INTO v_after
  FROM pg_proc
  WHERE oid IN (
    'public.custom_pipelines_insert_fn()'::regprocedure,
    'public.custom_pipelines_update_fn()'::regprocedure,
    'public.custom_pipeline_stages_insert_fn()'::regprocedure,
    'public.custom_pipeline_stages_update_fn()'::regprocedure
  );

  IF md5(v_before::text) IS DISTINCT FROM md5(v_after::text) THEN
    RAISE EXCEPTION 'REPROVOU: rollback não restaurou os quatro INSTEAD OF';
  END IF;

  IF to_regprocedure('public.fn_funil_custom_criar(jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_funil_custom_atualizar(uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_etapa_custom_criar(jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_etapa_custom_atualizar(uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public.criar_funil_custom_com_etapas(jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'REPROVOU: rollback deixou função nova';
  END IF;

  RAISE NOTICE 'ENSAIO_OK SCRUM-673 rollback: definições restauradas e funções novas removidas';
END;
$$;

ROLLBACK;
