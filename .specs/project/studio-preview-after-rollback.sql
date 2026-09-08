DO $$ BEGIN
  IF (SELECT count(*) FROM public.metrics_studio_panels) <> 2 THEN RAISE EXCEPTION 'rollback deve preservar apenas autoral e template editado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND layout->0->>'id' = 'original') THEN RAISE EXCEPTION 'rollback perdeu painel autoral'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE layout->0->>'id' = 'edicao-que-deve-sobreviver') THEN RAISE EXCEPTION 'rollback perdeu template editado'; END IF;
  IF to_regprocedure('public._metrics_studio_factory_templates()') IS NOT NULL THEN RAISE EXCEPTION 'rollback deixou factory'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'seed_metrics_studio_templates_after_org_insert') THEN RAISE EXCEPTION 'rollback deixou trigger'; END IF;
END $$;
SELECT 'PASS: rollback conserva autoral e template editado, remove apenas seeds intocados' AS result;
