DO $$ BEGIN
  IF (SELECT count(*) FROM public.metrics_studio_panels) <> 9 THEN RAISE EXCEPTION 'reapply duplicou/perdeu abas'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE template_key = 'visao-geral' AND layout->0->>'id' = 'edicao-que-deve-sobreviver') THEN RAISE EXCEPTION 'reapply sobrescreveu layout editado'; END IF;
END $$;
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('_metrics_studio_factory_templates', 'seed_metrics_studio_templates_on_org_create');
