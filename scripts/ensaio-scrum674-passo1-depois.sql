-- DEPOIS — asserções do ensaio do passo 1 da SCRUM-674.
-- Prova que a função nova produz a MESMA linha que a view produz, roda o
-- controle positivo, e ABORTA com ENSAIO_OK. Nada é gravado.

DO $$
DECLARE
  v_org      uuid;
  v_lead     uuid;
  v_slug     text;
  v_id_view  uuid;
  v_id_fn    uuid;
  v_md5_view text;
  v_md5_fn   text;
  v_md5_ctrl text;
  v_pre      uuid;
  v_sale     uuid;
  v_divergs  int  := 0;
  v_relato   text := '';
  v_recorte  text := 'id,created_at,updated_at,entered_at,stage_changed_at';
BEGIN
  -- Org REAL com os três funis de sistema e ao menos um lead e um membro.
  SELECT p.organization_id INTO v_org
    FROM public.pipelines p
   WHERE p.type = 'system' AND p.slug IN ('whatsapp','confirmacao','propostas')
   GROUP BY p.organization_id
  HAVING count(DISTINCT p.slug) = 3
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = p.organization_id)
     AND EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id = p.organization_id)
   ORDER BY p.organization_id
   LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: nenhuma org com os 3 funis de sistema, lead e membro. Sem dado real o ensaio não mede nada.';
  END IF;

  SELECT id INTO v_lead FROM public.leads        WHERE organization_id = v_org LIMIT 1;
  SELECT id INTO v_pre  FROM public.team_members WHERE organization_id = v_org LIMIT 1;
  SELECT id INTO v_sale FROM public.team_members WHERE organization_id = v_org AND id <> v_pre LIMIT 1;
  v_sale := COALESCE(v_sale, v_pre);

  RAISE NOTICE 'amostra: org=% lead=% pre=% sale=%', v_org, v_lead, v_pre, v_sale;

  -- ── 1. IGUALDADE view vs função, nos três funis de sistema ───────────────
  FOREACH v_slug IN ARRAY ARRAY['whatsapp','confirmacao','propostas'] LOOP
    v_id_view := gen_random_uuid();
    EXECUTE format(
      'INSERT INTO public.pipe_%s (id, lead_id, organization_id, pre_sale_responsible_id, sale_responsible_id) VALUES ($1,$2,$3,$4,$5)',
      v_slug) USING v_id_view, v_lead, v_org, v_pre, v_sale;

    -- A função é o MECANISMO; a forma legada do metadata é assunto do CHAMADOR.
    -- Quem passa as chaves legadas é o INSTEAD OF, no passo 2 — então o ensaio
    -- chama a função DO JEITO QUE A VIEW VAI CHAMAR. É isso que precisa ser
    -- provado: que o passo 2 preserva os bytes. Chamar a função "no mínimo" e
    -- comparar com a view mediria outra coisa.
    v_id_fn := public.fn_entrada_sistema_criar(
      p_organization_id         => v_org,
      p_slug                    => v_slug,
      p_lead_id                 => v_lead,
      p_pre_sale_responsible_id => v_pre,
      p_sale_responsible_id     => v_sale,
      p_metadata                => CASE v_slug
        WHEN 'whatsapp' THEN jsonb_build_object(
          'responsible_id', NULL, 'sdr_id', NULL, 'scheduled_date', NULL)
        WHEN 'confirmacao' THEN jsonb_build_object(
          'meeting_date', NULL, 'is_confirmed', false, 'closer_id', NULL,
          'responsible_id', NULL, 'sdr_id', NULL, 'meet_link', NULL,
          'metrics_period_at', NULL)
        WHEN 'propostas' THEN jsonb_build_object(
          'sale_value', NULL, 'closer_id', NULL, 'responsible_id', NULL,
          'product_id', NULL, 'product_type', NULL, 'calor', NULL,
          'loss_reason', NULL, 'loss_reason_id', NULL, 'commitment_date', NULL,
          'contract_duration', NULL, 'metrics_period_at', NULL)
      END);

    -- md5 do REGISTRO INTEIRO menos o que é legitimamente diferente. Comparar
    -- campo a campo escolhido a dedo é como se deixa passar a coluna que
    -- ninguém lembrou de olhar.
    SELECT md5((to_jsonb(pe) - string_to_array(v_recorte, ','))::text) INTO v_md5_view
      FROM public.pipeline_entries pe WHERE pe.id = v_id_view;
    SELECT md5((to_jsonb(pe) - string_to_array(v_recorte, ','))::text) INTO v_md5_fn
      FROM public.pipeline_entries pe WHERE pe.id = v_id_fn;

    IF v_md5_view IS DISTINCT FROM v_md5_fn THEN
      v_divergs := v_divergs + 1;
      v_relato := v_relato || format(E'\n  DIVERGE %s\n    view=%s\n    fn  =%s', v_slug,
        (SELECT (to_jsonb(pe) - string_to_array(v_recorte, ','))::text FROM public.pipeline_entries pe WHERE pe.id = v_id_view),
        (SELECT (to_jsonb(pe) - string_to_array(v_recorte, ','))::text FROM public.pipeline_entries pe WHERE pe.id = v_id_fn));
    ELSE
      RAISE NOTICE '  OK igualdade % (md5=%)', v_slug, left(v_md5_fn, 12);
    END IF;
  END LOOP;

  IF v_divergs > 0 THEN
    RAISE EXCEPTION 'ENSAIO REPROVOU: % funil(is) divergem entre view e função.%', v_divergs, v_relato;
  END IF;

  -- ── 2. CONTROLE POSITIVO ────────────────────────────────────────────────
  -- Par trocado TEM que divergir. Se não divergir, o md5 acima não mede nada.
  v_id_fn := public.fn_entrada_sistema_criar(
    p_organization_id         => v_org,
    p_slug                    => 'propostas',
    p_lead_id                 => v_lead,
    p_pre_sale_responsible_id => v_sale,
    p_sale_responsible_id     => v_pre);
  SELECT md5((to_jsonb(pe) - string_to_array(v_recorte, ','))::text) INTO v_md5_ctrl
    FROM public.pipeline_entries pe WHERE pe.id = v_id_fn;

  IF v_pre <> v_sale AND v_md5_ctrl = v_md5_fn THEN
    RAISE EXCEPTION 'CONTROLE POSITIVO FALHOU: par trocado deu o MESMO md5. O ensaio não mede nada.';
  END IF;
  IF v_pre = v_sale THEN
    RAISE NOTICE '  controle positivo PULADO: a org da amostra só tem 1 membro (par indistinguível)';
  ELSE
    RAISE NOTICE '  OK controle positivo (par trocado diverge, como deve)';
  END IF;

  -- ── 3. assigned_to NÃO derivado (decisão do CTO) ────────────────────────
  IF (SELECT assigned_to FROM public.pipeline_entries WHERE id = v_id_fn) IS NOT NULL THEN
    RAISE EXCEPTION 'REPROVOU: assigned_to veio preenchido sem o chamador ter mandado — a função está derivando, e derivar move de 2.800 a 7.900 cards de dono.';
  END IF;
  RAISE NOTICE '  OK assigned_to não derivado';

  -- ── 4. Ramo custom: stage_key derivado + strip_nulls ────────────────────
  DECLARE
    v_pipe_custom uuid;
    v_stage       uuid;
    v_sk_esperado text;
    v_sk_gravado  text;
    v_id_custom   uuid;
    v_org_custom  uuid;
  BEGIN
    SELECT p.id, p.organization_id, s.id, s.stage_key
      INTO v_pipe_custom, v_org_custom, v_stage, v_sk_esperado
      FROM public.pipelines p
      JOIN public.pipeline_stages s ON s.pipeline_id = p.id
     WHERE p.type = 'custom' AND p.is_active
       AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = p.organization_id)
     LIMIT 1;

    IF v_pipe_custom IS NULL THEN
      RAISE EXCEPTION 'ENSAIO ABORTADO: nenhum funil custom com etapa e lead.';
    END IF;

    SELECT id INTO v_lead FROM public.leads WHERE organization_id = v_org_custom LIMIT 1;

    v_id_custom := public.fn_entrada_custom_criar(
      p_organization_id => NULL,
      p_pipeline_id     => v_pipe_custom,
      p_lead_id         => v_lead,
      p_stage_id        => v_stage);

    SELECT stage_key INTO v_sk_gravado FROM public.pipeline_entries WHERE id = v_id_custom;
    IF v_sk_gravado IS DISTINCT FROM v_sk_esperado THEN
      RAISE EXCEPTION 'REPROVOU: stage_key não derivado da etapa (esperado=%, gravado=%). Sem ele os AFTER OF stage_key não disparam: disparo, workflow, checklist e história ficam mudos.',
        v_sk_esperado, v_sk_gravado;
    END IF;
    RAISE NOTICE '  OK stage_key derivado no ramo custom (%)', v_sk_gravado;

    IF (SELECT metadata ? 'pre_sale_responsible_id' FROM public.pipeline_entries WHERE id = v_id_custom) THEN
      RAISE EXCEPTION 'REPROVOU: ramo custom gravou chave nula no metadata; o contrato desta família é OMITIR (strip_nulls).';
    END IF;
    RAISE NOTICE '  OK strip_nulls preservado no ramo custom';

    -- E a família de sistema faz o OPOSTO: grava nulo explícito. As duas
    -- asserções juntas provam que a diferença não foi uniformizada.
    IF NOT (SELECT metadata ? 'sale_responsible_id' FROM public.pipeline_entries WHERE id = v_id_fn) THEN
      RAISE EXCEPTION 'REPROVOU: família de sistema omitiu a chave; o contrato dela é gravar nulo EXPLÍCITO.';
    END IF;
    RAISE NOTICE '  OK nulo explícito preservado na família de sistema';
  END;

  -- ── 5. Grants: função nova nasce executável ─────────────────────────────
  IF has_function_privilege('anon',
      'public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REPROVOU: anon pode executar fn_entrada_sistema_criar. O REVOKE não pegou — função nova NASCE executável pelo ALTER DEFAULT PRIVILEGES.';
  END IF;
  IF NOT has_function_privilege('authenticated',
      'public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REPROVOU: authenticated NÃO pode executar. Os INSTEAD OF rodam como o invocador e quebrariam.';
  END IF;
  RAISE NOTICE '  OK grants (anon fora, authenticated dentro)';

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-674 passo 1 — tudo verde. Abortando de propósito; nada foi gravado.';
END $$;

ROLLBACK;
