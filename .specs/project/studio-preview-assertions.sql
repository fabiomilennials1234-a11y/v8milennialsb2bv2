BEGIN;
DO $$ BEGIN
  IF has_function_privilege('service_role', 'public._metrics_studio_factory_templates()', 'EXECUTE') OR has_function_privilege('service_role', 'public.seed_metrics_studio_templates_on_org_create()', 'EXECUTE') THEN RAISE EXCEPTION 'função interna exposta ao service_role'; END IF;
  IF (SELECT count(*) FROM public.metrics_studio_panels WHERE organization_id = '11111111-1111-4111-8111-111111111111') <> 5 THEN RAISE EXCEPTION 'seed A incorreto'; END IF;
  IF (SELECT count(*) FROM public.metrics_studio_panels WHERE organization_id = '22222222-2222-4222-8222-222222222222') <> 4 THEN RAISE EXCEPTION 'seed B incorreto'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND nome = 'Painel autoral preservado' AND ordem = 8 AND layout->0->>'id' = 'original') THEN RAISE EXCEPTION 'painel autoral alterado'; END IF;
  IF EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND template_key IS NOT NULL AND ordem <= 8) THEN RAISE EXCEPTION 'ordem autoral não respeitada'; END IF;
  IF has_function_privilege('anon', 'public._metrics_studio_factory_templates()', 'EXECUTE') OR has_function_privilege('authenticated', 'public._metrics_studio_factory_templates()', 'EXECUTE') THEN RAISE EXCEPTION 'factory exposta'; END IF;
  IF has_function_privilege('anon', 'public.seed_metrics_studio_templates_on_org_create()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.seed_metrics_studio_templates_on_org_create()', 'EXECUTE') THEN RAISE EXCEPTION 'trigger exposto'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.metrics_studio_panels'::regclass) THEN RAISE EXCEPTION 'RLS desligada'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}', true);
DO $$ DECLARE affected integer; BEGIN
  IF (SELECT count(*) FROM public.metrics_studio_panels) <> 5 THEN RAISE EXCEPTION 'membro não lê as cinco abas da própria org'; END IF;
  IF EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE organization_id = '22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'leitura cross-tenant'; END IF;
  UPDATE public.metrics_studio_panels SET nome = 'tentativa' WHERE organization_id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'membro conseguiu editar'; END IF;
  DELETE FROM public.metrics_studio_panels WHERE organization_id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'membro conseguiu excluir'; END IF;
  BEGIN
    INSERT INTO public.metrics_studio_panels (organization_id, nome) VALUES ('11111111-1111-4111-8111-111111111111', 'tentativa');
    RAISE EXCEPTION 'membro conseguiu criar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}', true);
DO $$ DECLARE affected integer; BEGIN
  UPDATE public.metrics_studio_panels SET nome = 'Edição de admin' WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'admin não edita a própria aba'; END IF;
  UPDATE public.metrics_studio_panels SET nome = 'tentativa cross' WHERE organization_id = '22222222-2222-4222-8222-222222222222';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'admin editou outra org'; END IF;
  BEGIN
    UPDATE public.metrics_studio_panels SET organization_id = '22222222-2222-4222-8222-222222222222' WHERE id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    RAISE EXCEPTION 'WITH CHECK permitiu transferir aba';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.metrics_studio_panels (organization_id, nome) VALUES ('22222222-2222-4222-8222-222222222222', 'tentativa cross');
    RAISE EXCEPTION 'admin criou aba em outra org';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.metrics_studio_panels (id, organization_id, nome) VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '11111111-1111-4111-8111-111111111111', 'Criada pelo admin');
  DELETE FROM public.metrics_studio_panels WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'admin não exclui própria aba'; END IF;
  DELETE FROM public.metrics_studio_panels WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND template_key = 'mapa';
  IF (SELECT count(*) FROM public.metrics_studio_panels) <> 4 THEN RAISE EXCEPTION 'template removido reapareceu'; END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","role":"authenticated"}', true);
DO $$ DECLARE affected integer; BEGIN
  IF (SELECT count(*) FROM public.metrics_studio_panels WHERE organization_id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')) <> 8 THEN RAISE EXCEPTION 'master sem leitura cross-org'; END IF;
  UPDATE public.metrics_studio_panels SET nome = 'Master QA' WHERE organization_id = '22222222-2222-4222-8222-222222222222' AND template_key = 'mapa';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'master sem edição cross-org'; END IF;
END $$;

RESET ROLE;
INSERT INTO public.organizations (id, name, slug) VALUES ('33333333-3333-4333-8333-333333333333', 'Studio QA nova', 'studio-qa-nova');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.metrics_studio_panels WHERE organization_id = '33333333-3333-4333-8333-333333333333') <> 4 THEN RAISE EXCEPTION 'org nova sem os quatro templates'; END IF;
  IF EXISTS (SELECT 1 FROM public.metrics_studio_panels WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND template_key = 'mapa') THEN RAISE EXCEPTION 'seed de outra org ressuscitou template excluído'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: preservação, ordem, ACL, RLS membro/admin/master, exclusão e org nova' AS result;
