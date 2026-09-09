SELECT 'delete_system_pipeline' AS q, COALESCE(to_regprocedure('public.delete_system_pipeline(uuid,text)')::text,'AUSENTE') AS v
UNION ALL SELECT 'system_pipeline_delete_impact', COALESCE(to_regprocedure('public.system_pipeline_delete_impact(uuid,text)')::text,'AUSENTE')
UNION ALL SELECT 'anon_pode_deletar_funil', has_function_privilege('anon','public.delete_system_pipeline(uuid,text)','EXECUTE')::text
UNION ALL SELECT 'pipelines_sistema_ativos', count(*)::text FROM pipelines WHERE type='system' AND is_active
UNION ALL SELECT 'pipeline_entries_total', count(*)::text FROM pipeline_entries
UNION ALL SELECT 'leads_total', count(*)::text FROM leads;
