SELECT 'enable_system_pipeline' AS q, COALESCE(to_regprocedure('public.enable_system_pipeline(uuid,text)')::text,'AUSENTE') AS v
UNION ALL SELECT 'ensure_virou_noop',
  CASE WHEN pg_get_functiondef('public.ensure_pipeline_display_config(uuid)'::regprocedure) ~* 'INSERT INTO public.pipeline_display_config'
       THEN 'AINDA INSERE (torneira aberta)' ELSE 'no-op (torneira fechada)' END
UNION ALL SELECT 'linhas_display_config_intactas', count(*)::text FROM pipeline_display_config
UNION ALL SELECT 'anon_executa_enable', has_function_privilege('anon','public.enable_system_pipeline(uuid,text)','EXECUTE')::text;
