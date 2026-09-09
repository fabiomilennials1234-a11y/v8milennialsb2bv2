DO $$ BEGIN
  IF (SELECT count(*) FROM public.metrics_studio_panels WHERE organization_id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')) <> 9 THEN RAISE EXCEPTION 'rollback deve preservar todas as abas'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND layout->0->>'id' = 'original') THEN RAISE EXCEPTION 'rollback perdeu painel autoral'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE layout->0->>'id' = 'edicao-que-deve-sobreviver') THEN RAISE EXCEPTION 'rollback perdeu template editado'; END IF;
  IF to_regprocedure('public._metrics_studio_factory_templates()') IS NOT NULL THEN RAISE EXCEPTION 'rollback deixou factory'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'seed_metrics_studio_templates_after_org_insert') THEN RAISE EXCEPTION 'rollback deixou trigger'; END IF;
END $$;
SELECT 'PASS: rollback conserva todas as abas e retira apenas DDL de semeadura' AS result;
