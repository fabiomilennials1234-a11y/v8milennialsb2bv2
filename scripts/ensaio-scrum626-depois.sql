-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-626 — DEPOIS: com a fusão aplicada (na transação), prova que
-- (1) a ACL não mexeu onde não devia e ficou certa nas novas;
-- (2) todo wrapper devolve EXATAMENTE o baseline capturado antes;
-- (3) os caminhos novos por pipeline_id funcionam nos DOIS mundos;
-- (4) os deletes fundidos destroem o que prometem (e nada além);
-- e ABORTA com ENSAIO_OK. ROLLBACK final: nada é aplicado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A) ACL: wrappers intactos; get_pipeline_page e novas na matriz ─────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT g.fn, g.anon_x, g.auth_x, g.sr_x,
           bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))          AS anon_agora,
           bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth_agora,
           bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))  AS sr_agora
    FROM _e626_grants g
    JOIN pg_proc p ON p.proname = g.fn
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    GROUP BY g.fn, g.anon_x, g.auth_x, g.sr_x
  LOOP
    IF (r.anon_agora, r.auth_agora, r.sr_agora) IS DISTINCT FROM (r.anon_x, r.auth_x, r.sr_x) THEN
      RAISE EXCEPTION 'FAIL ACL: % era (anon=%,auth=%,sr=%) e ficou (anon=%,auth=%,sr=%)',
        r.fn, r.anon_x, r.auth_x, r.sr_x, r.anon_agora, r.auth_agora, r.sr_agora;
    END IF;
  END LOOP;
  RAISE NOTICE 'A ok: ACL das 12 assinaturas legadas idêntica ao snapshot (get_pipeline_page re-granted certo).';
END $$;

-- ─── B) Paridade de contagens ───────────────────────────────────────────────
DO $$
DECLARE v_dif int;
BEGIN
  SELECT count(*) INTO v_dif FROM (
    (SELECT stage_key, cnt FROM public.get_pipeline_stage_counts(
       'whatsapp', (SELECT v::uuid FROM _param WHERE k='org_mil'))
     EXCEPT SELECT stage_key, cnt FROM _e626_counts_sys)
    UNION ALL
    (SELECT stage_key, cnt FROM _e626_counts_sys
     EXCEPT SELECT stage_key, cnt FROM public.get_pipeline_stage_counts(
       'whatsapp', (SELECT v::uuid FROM _param WHERE k='org_mil')))) d;
  IF v_dif <> 0 THEN
    RAISE EXCEPTION 'FAIL contagem system: wrapper divergiu do baseline em % linha(s)', v_dif;
  END IF;

  SELECT count(*) INTO v_dif FROM (
    (SELECT stage_id, cnt FROM public.get_custom_pipeline_stage_counts(
       (SELECT v::uuid FROM _param WHERE k='pipe_cus'), (SELECT v::uuid FROM _param WHERE k='org_mil'))
     EXCEPT SELECT stage_id, cnt FROM _e626_counts_cus)
    UNION ALL
    (SELECT stage_id, cnt FROM _e626_counts_cus
     EXCEPT SELECT stage_id, cnt FROM public.get_custom_pipeline_stage_counts(
       (SELECT v::uuid FROM _param WHERE k='pipe_cus'), (SELECT v::uuid FROM _param WHERE k='org_mil')))) d;
  IF v_dif <> 0 THEN
    RAISE EXCEPTION 'FAIL contagem custom: wrapper divergiu do baseline em % linha(s)', v_dif;
  END IF;

  -- Motor por id devolve stage_id E stage_key coerentes com o wrapper.
  SELECT count(*) INTO v_dif FROM (
    SELECT c.stage_key, sum(c.cnt) FROM public.get_pipeline_stage_counts_by_id(
      (SELECT v::uuid FROM _param WHERE k='pipe_sys'), (SELECT v::uuid FROM _param WHERE k='org_mil')) c
    GROUP BY c.stage_key
    EXCEPT SELECT stage_key, cnt FROM _e626_counts_sys) d;
  IF v_dif <> 0 THEN
    RAISE EXCEPTION 'FAIL motor de contagem por id: divergiu do baseline system em % linha(s)', v_dif;
  END IF;
  RAISE NOTICE 'B ok: contagens idênticas (wrapper sys, wrapper cus, motor por id).';
END $$;

-- ─── C) Paridade da página do kanban (slug E id) ────────────────────────────
DO $$
DECLARE v_old jsonb; v_slug jsonb; v_id jsonb; v_cus int;
BEGIN
  SELECT pg INTO v_old FROM _e626_page_sys;

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id) INTO v_slug
  FROM public.get_pipeline_page(
    p_pipeline_slug => 'whatsapp',
    p_stage_id      => (SELECT v FROM _param WHERE k='stage_top'),
    p_org_id        => (SELECT v::uuid FROM _param WHERE k='org_mil'),
    p_page_size     => 50) t;

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id) INTO v_id
  FROM public.get_pipeline_page(
    p_pipeline_id   => (SELECT v::uuid FROM _param WHERE k='pipe_sys'),
    p_stage_id      => (SELECT v FROM _param WHERE k='stage_top'),
    p_org_id        => (SELECT v::uuid FROM _param WHERE k='org_mil'),
    p_page_size     => 50) t;

  IF v_slug IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'FAIL página por slug: shape/conteúdo divergiu do baseline';
  END IF;
  IF v_id IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'FAIL página por id: divergiu do caminho por slug';
  END IF;

  -- Caminho NOVO: página de funil CUSTOM pela mesma RPC (vitória da fusão) —
  -- as linhas da etapa mais povoada de C batem com a contagem do baseline.
  SELECT count(*) INTO v_cus
  FROM public.get_pipeline_page(
    p_pipeline_id => (SELECT v::uuid FROM _param WHERE k='pipe_cus'),
    p_stage_id    => (SELECT ps.stage_key FROM public.pipeline_stages ps
                       WHERE ps.id = (SELECT c.stage_id FROM _e626_counts_cus c
                                       ORDER BY c.cnt DESC NULLS LAST LIMIT 1)),
    p_org_id      => (SELECT v::uuid FROM _param WHERE k='org_mil'),
    p_page_size   => 100000) t;
  IF v_cus <> (SELECT max(cnt) FROM _e626_counts_cus) THEN
    RAISE EXCEPTION 'FAIL página custom por id: % linha(s), baseline contava %',
      v_cus, (SELECT max(cnt) FROM _e626_counts_cus);
  END IF;
  RAISE NOTICE 'C ok: página idêntica por slug e por id; funil custom paginável (% linhas na etapa top).', v_cus;
END $$;

-- ─── D) Paridade dos públicos de disparo ────────────────────────────────────
DO $$
BEGIN
  IF (SELECT array_agg(x ORDER BY x) FROM public.get_stage_lead_ids(
        'whatsapp', (SELECT v FROM _param WHERE k='stage_top'),
        (SELECT v::uuid FROM _param WHERE k='org_mil')) x)
     IS DISTINCT FROM (SELECT ids_stage FROM _e626_ids) THEN
    RAISE EXCEPTION 'FAIL get_stage_lead_ids: divergiu do baseline';
  END IF;

  IF (SELECT array_agg(x ORDER BY x) FROM public.get_filtered_lead_ids(
        p_pipeline_type => 'whatsapp', p_search => 'a',
        p_organization_id => (SELECT v::uuid FROM _param WHERE k='org_mil')) x)
     IS DISTINCT FROM (SELECT ids_filtered FROM _e626_ids) THEN
    RAISE EXCEPTION 'FAIL get_filtered_lead_ids: divergiu do baseline';
  END IF;

  IF (SELECT array_agg(x ORDER BY x) FROM public.get_custom_filtered_lead_ids(
        p_pipeline_id => (SELECT v::uuid FROM _param WHERE k='pipe_cus'),
        p_organization_id => (SELECT v::uuid FROM _param WHERE k='org_mil')) x)
     IS DISTINCT FROM (SELECT ids_custom FROM _e626_ids) THEN
    RAISE EXCEPTION 'FAIL get_custom_filtered_lead_ids: divergiu do baseline';
  END IF;

  -- Motor por id == wrapper custom; contrato do wrapper de etapa preservado
  -- (p_stage_key NULL segue devolvendo vazio, sem escape para o funil todo).
  IF (SELECT array_agg(x ORDER BY x) FROM public.get_pipeline_lead_ids(
        p_pipeline_id => (SELECT v::uuid FROM _param WHERE k='pipe_cus'),
        p_organization_id => (SELECT v::uuid FROM _param WHERE k='org_mil')) x)
     IS DISTINCT FROM (SELECT ids_custom FROM _e626_ids) THEN
    RAISE EXCEPTION 'FAIL get_pipeline_lead_ids por id: divergiu do wrapper custom';
  END IF;
  IF EXISTS (SELECT 1 FROM public.get_stage_lead_ids('whatsapp', NULL,
               (SELECT v::uuid FROM _param WHERE k='org_mil'))) THEN
    RAISE EXCEPTION 'FAIL get_stage_lead_ids: stage NULL passou a devolver o funil todo (quebra de contrato)';
  END IF;
  RAISE NOTICE 'D ok: públicos idênticos (3 wrappers + motor por id + guarda de stage NULL).';
END $$;

-- ─── E) Paridade do impact (3 vias, valor a valor) ──────────────────────────
DO $$
DECLARE v_old jsonb; v_wrap jsonb; v_novo jsonb;
BEGIN
  SELECT imp_cus INTO v_old FROM _e626_impacts;
  v_wrap := public.custom_pipeline_delete_impact((SELECT v::uuid FROM _param WHERE k='pipe_del'));
  v_novo := public.pipeline_delete_impact((SELECT v::uuid FROM _param WHERE k='pipe_del'));
  IF v_wrap IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'FAIL impact custom: wrapper divergiu do baseline. antes=% agora=%', v_old, v_wrap;
  END IF;
  IF v_novo IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'FAIL impact custom: pipeline_delete_impact divergiu do baseline. antes=% agora=%', v_old, v_novo;
  END IF;
  RAISE NOTICE 'E ok: impact custom idêntico nas 3 vias.';
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _param WHERE k='uid_peq'), 'role', 'authenticated')::text,
  true);

DO $$
DECLARE v_old jsonb; v_wrap jsonb;
BEGIN
  SELECT imp_sys_peq INTO v_old FROM _e626_impacts;
  v_wrap := public.system_pipeline_delete_impact(
    (SELECT v::uuid FROM _param WHERE k='org_peq'), 'whatsapp');
  IF v_wrap IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'FAIL impact system: wrapper divergiu do baseline. antes=% agora=%', v_old, v_wrap;
  END IF;
  RAISE NOTICE 'E2 ok: impact system idêntico ao baseline (org pequena).';
END $$;

-- ─── F) Delete SYSTEM fundido (org pequena, rolado no ROLLBACK final) ───────
DO $$
DECLARE
  v_org uuid := (SELECT v::uuid FROM _param WHERE k='org_peq');
  v_imp jsonb; v_res jsonb; v_n int;
BEGIN
  SELECT imp_sys_peq INTO v_imp FROM _e626_impacts;
  v_res := public.delete_system_pipeline(v_org, 'whatsapp');

  -- O resultado = impact do baseline + os 3 contadores (shape e valores).
  IF v_res - 'automacoes_desativadas' - 'disparos_neutralizados' - 'agentes_ajustados'
     IS DISTINCT FROM v_imp THEN
    RAISE EXCEPTION 'FAIL delete system: bloco de impact do retorno divergiu do baseline. antes=% agora=%', v_imp, v_res;
  END IF;
  IF (v_res->>'automacoes_desativadas')::int IS DISTINCT FROM (v_imp->>'automacoes')::int THEN
    RAISE EXCEPTION 'FAIL delete system: automacoes_desativadas=% ≠ automacoes previstas=%',
      v_res->>'automacoes_desativadas', v_imp->>'automacoes';
  END IF;
  IF (v_res->>'agentes_ajustados')::int IS DISTINCT FROM (v_imp->>'agentes_copilot')::int THEN
    RAISE EXCEPTION 'FAIL delete system: agentes_ajustados=% ≠ agentes_copilot previstos=%',
      v_res->>'agentes_ajustados', v_imp->>'agentes_copilot';
  END IF;

  -- Destruição completa: registro, linha, cards, etapas, espelho no lead.
  SELECT count(*) INTO v_n FROM public.pipeline_display_config
   WHERE organization_id = v_org AND pipe_type = 'whatsapp';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete system: display_config sobreviveu'; END IF;
  SELECT count(*) INTO v_n FROM public.pipelines
   WHERE organization_id = v_org AND slug = 'whatsapp';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete system: linha de pipelines sobreviveu'; END IF;
  SELECT count(*) INTO v_n FROM public.pipeline_stages
   WHERE organization_id = v_org AND pipeline_type = 'whatsapp';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete system: % etapa(s) sobreviveram', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.leads
   WHERE organization_id = v_org AND pipe_whatsapp IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete system: % lead(s) com espelho pipe_whatsapp vivo', v_n; END IF;
  RAISE NOTICE 'F ok: delete system fundido — retorno=%, tudo destruído.', v_res;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _param WHERE k='uid_mil'), 'role', 'authenticated')::text,
  true);

-- ─── G) Delete CUSTOM fundido (Milennials, rolado no ROLLBACK final) ────────
DO $$
DECLARE
  v_pipe uuid := (SELECT v::uuid FROM _param WHERE k='pipe_del');
  v_imp jsonb; v_res jsonb; v_n int;
BEGIN
  SELECT imp_cus INTO v_imp FROM _e626_impacts;
  v_res := public.delete_custom_pipeline(v_pipe);

  IF v_res - 'automacoes_desativadas' - 'disparos_neutralizados'
     IS DISTINCT FROM v_imp THEN
    RAISE EXCEPTION 'FAIL delete custom: bloco de impact do retorno divergiu do baseline. antes=% agora=%', v_imp, v_res;
  END IF;
  IF (v_res->>'automacoes_desativadas')::int IS DISTINCT FROM (v_imp->>'automacoes')::int THEN
    RAISE EXCEPTION 'FAIL delete custom: automacoes_desativadas=% ≠ automacoes previstas=%',
      v_res->>'automacoes_desativadas', v_imp->>'automacoes';
  END IF;
  SELECT count(*) INTO v_n FROM public.pipelines WHERE id = v_pipe;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete custom: linha de pipelines sobreviveu'; END IF;
  SELECT count(*) INTO v_n FROM public.pipeline_entries WHERE pipeline_id = v_pipe;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete custom: % card(s) sobreviveram', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.pipeline_stages WHERE pipeline_id = v_pipe;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL delete custom: % etapa(s) sobreviveram', v_n; END IF;
  RAISE NOTICE 'G ok: delete custom fundido — retorno=%, tudo destruído.', v_res;
END $$;

-- ─── H) Bulk fundido: wrapper por slug, motor por id, contrato custom ───────
DO $$
DECLARE
  v_lead uuid := (SELECT v::uuid FROM _param WHERE k='lead_bulk');
  v_sys  uuid := (SELECT v::uuid FROM _param WHERE k='pipe_sys');
  v_alvo uuid := (SELECT v::uuid FROM _param WHERE k='stage_alvo_id');
  v_alvo_key text; v_volta_id uuid; v_volta_key text;
  v_n int;
BEGIN
  SELECT stage_key INTO v_alvo_key FROM public.pipeline_stages WHERE id = v_alvo;
  SELECT stage_id, stage_key INTO v_volta_id, v_volta_key FROM _e626_bulk_antes LIMIT 1;

  -- H1: wrapper legado por (slug, stage_key) move e espelha o uuid.
  PERFORM public.bulk_move_stage(ARRAY[v_lead], 'whatsapp', v_alvo_key);
  SELECT count(*) INTO v_n FROM public.pipeline_entries pe
   WHERE pe.pipeline_id = v_sys AND pe.lead_id = v_lead
     AND pe.stage_key = v_alvo_key AND pe.stage_id = v_alvo;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'FAIL bulk wrapper: card não chegou na etapa alvo com stage_id espelhado';
  END IF;

  -- H2: motor por id devolve o card à etapa original — bulk em funil de
  -- SISTEMA por pipeline_id é exatamente a vitória da fusão.
  PERFORM public.bulk_add_to_pipeline(ARRAY[v_lead], v_sys, v_volta_id);
  SELECT count(*) INTO v_n FROM public.pipeline_entries pe
   WHERE pe.pipeline_id = v_sys AND pe.lead_id = v_lead
     AND pe.stage_id = v_volta_id AND pe.stage_key = v_volta_key;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'FAIL bulk motor por id: card não voltou à etapa original';
  END IF;

  -- H3: wrapper custom adiciona ao funil C (INSERT ou UPDATE, tanto faz —
  -- o card tem de existir na etapa pedida).
  PERFORM public.bulk_add_to_custom_pipe(ARRAY[v_lead],
    (SELECT v::uuid FROM _param WHERE k='pipe_cus'),
    (SELECT v::uuid FROM _param WHERE k='stage_cus_id'));
  SELECT count(*) INTO v_n FROM public.pipeline_entries pe
   WHERE pe.pipeline_id = (SELECT v::uuid FROM _param WHERE k='pipe_cus')
     AND pe.lead_id = v_lead
     AND pe.stage_id = (SELECT v::uuid FROM _param WHERE k='stage_cus_id');
  IF v_n = 0 THEN
    RAISE EXCEPTION 'FAIL bulk wrapper custom: card não entrou no funil custom';
  END IF;

  -- H4: contrato preservado — a assinatura custom recusa funil de sistema
  -- (skip silencioso: nada muda).
  PERFORM public.bulk_add_to_custom_pipe(ARRAY[v_lead], v_sys, v_alvo);
  SELECT count(*) INTO v_n FROM public.pipeline_entries pe
   WHERE pe.pipeline_id = v_sys AND pe.lead_id = v_lead AND pe.stage_id = v_alvo;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL contrato: bulk_add_to_custom_pipe aceitou funil de sistema';
  END IF;
  RAISE NOTICE 'H ok: bulk fundido (wrapper slug, motor por id em funil de sistema, wrapper custom, contrato).';
END $$;

-- ─── ENSAIO_OK: aborta ──────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE EXCEPTION 'ENSAIO_OK SCRUM-626 — RPCs fundidas por pipeline_id: ACL intacta, wrappers byte-a-byte com o baseline, caminhos por id vivos nos dois mundos, deletes e bulks fundidos provados (e rolados).';
END $$;

ROLLBACK;
