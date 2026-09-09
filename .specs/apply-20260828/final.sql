SELECT 'ledger_202709xx' AS q,
       (SELECT string_agg(version, ', ' ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version LIKE '2027090[34]%') AS v
UNION ALL SELECT 'definir_desfecho_da_entrada', COALESCE(to_regprocedure('public.definir_desfecho_da_entrada(uuid,text,text)')::text,'AUSENTE')
UNION ALL SELECT 'garantir_negocio_da_entrada', COALESCE(to_regprocedure('public.garantir_negocio_da_entrada(uuid)')::text,'AUSENTE')
UNION ALL SELECT 'authenticated_executa_rpc', has_function_privilege('authenticated','public.definir_desfecho_da_entrada(uuid,text,text)','EXECUTE')::text
UNION ALL SELECT 'anon_executa_rpc', has_function_privilege('anon','public.definir_desfecho_da_entrada(uuid,text,text)','EXECUTE')::text
UNION ALL SELECT 'medidas_no_catalogo', (SELECT string_agg(id,', ' ORDER BY id) FROM metric_catalog_measures WHERE id IN ('valor_em_aberto','valor_perdido'));
