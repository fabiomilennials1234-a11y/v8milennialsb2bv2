-- ============================================================================
-- ENSAIO ABORTÁVEL — SCRUM-625 (API aceita qualquer funil), contra PROD.
-- Roda via: node scripts/prod-sql.mjs --file <combinado>  (BEGIN ... ROLLBACK)
-- O combinado = este arquivo com a migration 20270909000000 inlined no marcador.
-- pg_net enfileira em tabela → o ROLLBACK desfaz a fila junto: nenhum HTTP sai.
-- ============================================================================
BEGIN;

-- ── 1. Baseline: output do api_list_pipelines ANTIGO, org a org ─────────────
CREATE TEMP TABLE _ens625_baseline AS
  SELECT o.id AS org_id, public.api_list_pipelines(o.id) AS antes
    FROM public.organizations o;

-- ── 2. A migration ──────────────────────────────────────────────────────────
-- >>>MIGRATION<<<

-- ── 3. Colapso do CASE provado por igualdade de output ─────────────────────
DO $$
DECLARE v_n int; v_orgs text;
BEGIN
  SELECT count(*), string_agg(b.org_id::text, ', ') INTO v_n, v_orgs
    FROM _ens625_baseline b
   WHERE b.antes IS DISTINCT FROM public.api_list_pipelines(b.org_id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ENSAIO 625: api_list_pipelines diverge em % orgs: %', v_n, v_orgs;
  END IF;
  RAISE NOTICE 'ENSAIO 625: api_list_pipelines idêntico em todas as orgs';
END $$;

-- ── 4. Assinaturas intactas (chamada antiga continua válida) ────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('abrir_negocio', 9, 6), ('mover_negocio', 5, 2), ('api_move_deal', 5, 1),
    ('api_create_deal', 10, 6), ('api_list_pipelines', 1, 0)
  ) AS x(fn, nargs, ndef) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn
         AND p.pronargs = r.nargs AND p.pronargdefaults = r.ndef
    ) OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = r.fn) <> 1 THEN
      RAISE EXCEPTION 'ENSAIO 625: assinatura de % mudou (ou ganhou sobrecarga)', r.fn;
    END IF;
  END LOOP;
END $$;

-- ── 5. Playground sintético (org própria: zero interferência com orgs reais) ─
DO $$
DECLARE
  v_org  uuid := gen_random_uuid();
  v_sys  uuid := gen_random_uuid();
  v_cus  uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_st_onb uuid; v_st_atv uuid;
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_d4 uuid; v_d5 uuid;
  v_res jsonb;
  v_pe record;
  v_ok boolean := false;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, '[ENSAIO-625] descartável', 'ensaio-625-' || substr(v_org::text, 1, 8));
  INSERT INTO public.pipelines (id, organization_id, name, slug, type, display_order, is_active)
  VALUES (v_sys, v_org, 'Qualificação', 'whatsapp',  'system', 0, true),
         (v_cus, v_org, 'Pós-venda',    'pos-venda', 'custom', 10, true);
  INSERT INTO public.pipeline_stages (organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active)
  VALUES (v_org, v_sys, 'whatsapp',  'novo_lead',  'Novo',       0, true),
         (v_org, v_sys, 'whatsapp',  'abordado',   'Abordado',   1, true),
         (v_org, v_cus, 'pos-venda', 'onboarding', 'Onboarding', 0, true),
         (v_org, v_cus, 'pos-venda', 'ativo',      'Ativo',      1, true);
  SELECT id INTO v_st_onb FROM public.pipeline_stages WHERE pipeline_id = v_cus AND stage_key = 'onboarding';
  SELECT id INTO v_st_atv FROM public.pipeline_stages WHERE pipeline_id = v_cus AND stage_key = 'ativo';
  INSERT INTO public.leads (id, organization_id, name) VALUES (v_lead, v_org, '[ENSAIO-625] lead');

  -- A) regressão: sistema por slug, forma antiga (posições + procedência)
  v_d1 := public.abrir_negocio(v_lead, 'whatsapp', 'novo_lead', NULL, NULL, NULL, NULL, NULL, 'api');
  SELECT * INTO v_pe FROM public.pipeline_entries WHERE deal_id = v_d1;
  IF v_pe.pipeline_id <> v_sys OR v_pe.stage_key <> 'novo_lead' THEN
    RAISE EXCEPTION 'ENSAIO 625/A: abrir whatsapp por slug quebrou (%, %)', v_pe.pipeline_id, v_pe.stage_key;
  END IF;

  -- B) NOVO: custom por uuid puro + etapa por stage_key
  v_d2 := public.abrir_negocio(v_lead, v_cus::text, 'onboarding', NULL, NULL, NULL, NULL, NULL, 'api');
  SELECT * INTO v_pe FROM public.pipeline_entries WHERE deal_id = v_d2;
  IF v_pe.pipeline_id <> v_cus OR v_pe.stage_key <> 'onboarding' OR v_pe.stage_id <> v_st_onb THEN
    RAISE EXCEPTION 'ENSAIO 625/B: abrir custom por uuid+key quebrou';
  END IF;

  -- C) LEGADO: custom:<uuid> + etapa por uuid (a forma antiga exata)
  v_d3 := public.abrir_negocio(v_lead, 'custom:' || v_cus::text, v_st_onb::text, NULL, NULL, NULL, NULL, NULL, 'api');
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries WHERE deal_id = v_d3 AND pipeline_id = v_cus AND stage_id = v_st_onb) THEN
    RAISE EXCEPTION 'ENSAIO 625/C: forma legada custom: quebrou';
  END IF;

  -- D) NOVO: custom por slug
  v_d4 := public.abrir_negocio(v_lead, 'pos-venda', 'ativo', NULL, NULL, NULL, NULL, NULL, 'api');
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries WHERE deal_id = v_d4 AND pipeline_id = v_cus AND stage_key = 'ativo') THEN
    RAISE EXCEPTION 'ENSAIO 625/D: abrir custom por slug quebrou';
  END IF;

  -- E) api_create_deal em funil custom por slug — cria e AVISA (já há aberto lá)
  v_res := public.api_create_deal(v_org, v_lead, 'pos-venda', 'onboarding');
  IF v_res->>'status' <> 'created' OR v_res->'warning'->>'code' <> 'lead_has_open_deal_in_pipeline' THEN
    RAISE EXCEPTION 'ENSAIO 625/E: api_create_deal custom por slug: %', v_res;
  END IF;

  -- E2) api_create_deal na forma legada completa (custom: + etapa uuid)
  v_res := public.api_create_deal(v_org, v_lead, 'custom:' || v_cus::text, v_st_atv::text);
  IF v_res->>'status' <> 'created' THEN
    RAISE EXCEPTION 'ENSAIO 625/E2: forma legada no api_create_deal: %', v_res;
  END IF;

  -- F) api_move_deal sistema→custom por uuid (a recusa 422 morreu)
  v_res := public.api_move_deal(v_org, v_d1, v_cus::text, 'onboarding');
  IF v_res->>'pipeline_slug' <> 'pos-venda' OR v_res->>'stage_key' <> 'onboarding' THEN
    RAISE EXCEPTION 'ENSAIO 625/F: move sistema→custom: %', v_res;
  END IF;

  -- G) api_move_deal custom→sistema por slug (regressão) + H) alias legado
  v_res := public.api_move_deal(v_org, v_d1, 'whatsapp', 'abordado');
  IF v_res->>'pipeline_slug' <> 'whatsapp' OR v_res->>'stage_key' <> 'abordado' THEN
    RAISE EXCEPTION 'ENSAIO 625/G: move de volta a sistema: %', v_res;
  END IF;
  v_res := public.api_move_deal(v_org, v_d1, 'qualificacao', 'novo_lead');
  IF v_res->>'pipeline_slug' <> 'whatsapp' THEN
    RAISE EXCEPTION 'ENSAIO 625/H: alias qualificacao: %', v_res;
  END IF;

  -- I) mover_negocio direto, etapa custom por uuid
  PERFORM public.mover_negocio((SELECT id FROM public.pipeline_entries WHERE deal_id = v_d2), v_cus, v_st_atv::text);
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries WHERE deal_id = v_d2 AND stage_key = 'ativo' AND stage_id = v_st_atv) THEN
    RAISE EXCEPTION 'ENSAIO 625/I: mover_negocio etapa por uuid quebrou';
  END IF;

  -- J) funil inexistente erra alto e legível
  BEGIN
    PERFORM public.api_move_deal(v_org, v_d1, 'nao-existe', 'x');
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%não existe nesta organização%' THEN
      RAISE EXCEPTION 'ENSAIO 625/J: mensagem errada: %', SQLERRM;
    END IF;
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ENSAIO 625/J: funil inexistente não foi recusado'; END IF;

  -- K) etapa inexistente em funil custom erra alto
  v_ok := false;
  BEGIN
    PERFORM public.api_move_deal(v_org, v_d1, 'pos-venda', 'etapa-fantasma');
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%Etapa%não existe no funil%' THEN
      RAISE EXCEPTION 'ENSAIO 625/K: mensagem errada: %', SQLERRM;
    END IF;
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ENSAIO 625/K: etapa fantasma não foi recusada'; END IF;

  -- L) catálogo da org sintética: funil custom vem com etapas (id + stage_key)
  v_res := public.api_list_pipelines(v_org);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res) f, jsonb_array_elements(f->'stages') s
     WHERE f->>'id' = v_cus::text AND s->>'stage_key' = 'onboarding' AND (s->>'id') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ENSAIO 625/L: catálogo sem etapas do funil custom: %', v_res;
  END IF;

  RAISE NOTICE 'ENSAIO_OK — SCRUM-625: A..L verdes (regressão sistema, custom por uuid/slug/legado, aliases, erros legíveis, catálogo)';
END $$;

ROLLBACK;
