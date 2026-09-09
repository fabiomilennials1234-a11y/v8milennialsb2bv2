DO $$
DECLARE
  ctx _ensaio673_contexto%ROWTYPE;
  v_pipeline_after jsonb;
  v_stage_after jsonb;
  v_poison jsonb;
  v_view_pipeline public.custom_pipelines%ROWTYPE;
  v_view_stage public.custom_pipeline_stages%ROWTYPE;
  v_lead uuid;
  v_slug text;
  v_stage_key text;
  v_system_stage uuid;
  v_system_entry uuid;
  v_custom_entry uuid;
BEGIN
  SELECT * INTO ctx FROM _ensaio673_contexto;

  PERFORM public.fn_funil_custom_criar(jsonb_build_object(
    'id', ctx.pipeline_id,
    'organization_id', ctx.organization_id,
    'name', 'Ensaio SCRUM-673',
    'slug', 'ensaio-scrum-673',
    'description', 'antes',
    'icon', 'target',
    'color', '#123456',
    'position', 4,
    'is_active', true,
    'created_by', null,
    'created_at', '2026-09-04 10:00:00+00',
    'updated_at', '2026-09-04 10:00:00+00',
    'lifecycle_type', 'temporary',
    'starts_at', '2026-09-05 10:00:00+00',
    'ends_at', '2026-09-10 10:00:00+00',
    'status', 'draft',
    'team_goal', 12,
    'individual_goal', 3,
    'bonus_value', 500,
    'bonus_description', 'bônus',
    'objective_pipe_type', 'propostas',
    'objective_stage_key', 'enviada',
    'template_type', 'prospeccao',
    'lead_source_config', '{"origem":"ensaio"}'::jsonb));

  PERFORM public.fn_etapa_custom_criar(jsonb_build_object(
    'id', ctx.stage_id,
    'organization_id', ctx.organization_id,
    'pipeline_id', ctx.pipeline_id,
    'stage_key', 'entrada',
    'name', 'Entrada',
    'color', '#654321',
    'position', 2,
    'is_active', true,
    'is_final_positive', false,
    'is_final_negative', false,
    'target_pipe_type', 'confirmacao',
    'target_stage_key', 'marcada',
    'created_at', '2026-09-04 10:00:00+00',
    'updated_at', '2026-09-04 10:00:00+00',
    'stage_role', 'open',
    'requires_sale_value', false));

  PERFORM public.fn_funil_custom_atualizar(ctx.pipeline_id, jsonb_build_object(
    'description', 'depois',
    'status', 'paused',
    'position', 7,
    'lead_source_config', '{"origem":"ensaio","versao":2}'::jsonb));

  PERFORM public.fn_etapa_custom_atualizar(ctx.stage_id, jsonb_build_object(
    'name', 'Entrada revisada',
    'color', '#abcdef',
    'position', 5,
    'target_pipe_type', null,
    'target_stage_key', null,
    'requires_sale_value', true));

  SELECT to_jsonb(p) - 'updated_at' INTO v_pipeline_after
  FROM public.pipelines p WHERE id = ctx.pipeline_id;
  SELECT to_jsonb(ps) - 'updated_at' INTO v_stage_after
  FROM public.pipeline_stages ps WHERE id = ctx.stage_id;

  IF md5(ctx.pipeline_before::text) IS DISTINCT FROM md5(v_pipeline_after::text) THEN
    RAISE EXCEPTION 'REPROVOU: funil divergiu.%',
      format(E'\nantes=%s\ndepois=%s', ctx.pipeline_before, v_pipeline_after);
  END IF;
  IF md5(ctx.stage_before::text) IS DISTINCT FROM md5(v_stage_after::text) THEN
    RAISE EXCEPTION 'REPROVOU: etapa divergiu.%',
      format(E'\nantes=%s\ndepois=%s', ctx.stage_before, v_stage_after);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid IN (
      'public.custom_pipelines_insert_fn()'::regprocedure,
      'public.custom_pipelines_update_fn()'::regprocedure,
      'public.custom_pipeline_stages_insert_fn()'::regprocedure,
      'public.custom_pipeline_stages_update_fn()'::regprocedure)
      AND prosrc !~ 'fn_(funil|etapa)_custom_'
  ) THEN
    RAISE EXCEPTION 'REPROVOU: INSTEAD OF não delega à função compartilhada';
  END IF;

  IF has_function_privilege('anon', 'public.fn_funil_custom_criar(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_funil_custom_atualizar(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapa_custom_criar(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapa_custom_atualizar(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.criar_funil_custom_com_etapas(jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REPROVOU: anon executa função nova';
  END IF;

  BEGIN
    PERFORM public.criar_funil_custom_com_etapas(
      jsonb_build_object(
        'id', ctx.atomic_pipeline_id,
        'organization_id', ctx.organization_id,
        'name', 'Ensaio atômico',
        'slug', 'ensaio-atomico'),
      jsonb_build_array(
        jsonb_build_object('stage_key', 'ok', 'name', 'OK', 'position', 0),
        jsonb_build_object('stage_key', 'invalida', 'name', null, 'position', 1)));
    RAISE EXCEPTION 'REPROVOU: fixture inválida foi aceita';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.pipelines WHERE id = ctx.atomic_pipeline_id) THEN
    RAISE EXCEPTION 'REPROVOU: criação parcial deixou funil órfão';
  END IF;

  -- Compatibilidade durante rollout: RETURNING da view ainda traz defaults.
  INSERT INTO public.custom_pipelines(id, organization_id, name, slug)
  VALUES (ctx.atomic_pipeline_id, ctx.organization_id, 'Compat SCRUM-673', 'compat-scrum-673')
  RETURNING * INTO v_view_pipeline;
  IF v_view_pipeline.icon IS DISTINCT FROM 'kanban'
     OR v_view_pipeline.color IS DISTINCT FROM '#3b82f6'
     OR v_view_pipeline.position IS DISTINCT FROM 0
     OR v_view_pipeline.lifecycle_type IS DISTINCT FROM 'permanent'
     OR v_view_pipeline.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'REPROVOU: RETURNING do espelho de funil perdeu defaults';
  END IF;

  INSERT INTO public.custom_pipeline_stages(
    organization_id, pipeline_id, stage_key, name)
  VALUES (ctx.organization_id, ctx.atomic_pipeline_id, 'compat', 'Compat')
  RETURNING * INTO v_view_stage;
  IF v_view_stage.color IS DISTINCT FROM '#64748b'
     OR v_view_stage.position IS DISTINCT FROM 0
     OR v_view_stage.stage_role IS DISTINCT FROM 'open'
     OR v_view_stage.requires_sale_value IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'REPROVOU: RETURNING do espelho de etapa perdeu defaults';
  END IF;

  BEGIN
    PERFORM public.fn_funil_custom_atualizar(
      ctx.atomic_pipeline_id,
      jsonb_build_object(
        'status', 'paused',
        '_expected_lifecycle_type', 'temporary'));
    RAISE EXCEPTION 'sentinela_funil_permanente_aceitou_transicao_temporaria';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sentinela_funil_permanente_aceitou_transicao_temporaria'
       OR strpos(SQLERRM, 'não tem lifecycle_type temporary') = 0 THEN
      RAISE;
    END IF;
  END;

  DELETE FROM public.custom_pipeline_stages WHERE id = v_view_stage.id;
  DELETE FROM public.custom_pipelines WHERE id = ctx.atomic_pipeline_id;

  -- Campos editados na ficha do lead são projetados atomicamente na base.
  PERFORM set_config('app.skip_default_pipe', '1', true);
  INSERT INTO public.leads(organization_id, name, origin)
  VALUES (ctx.organization_id, 'Ensaio SCRUM-673 ' || gen_random_uuid()::text, 'outro')
  RETURNING id INTO v_lead;

  FOREACH v_slug IN ARRAY ARRAY['whatsapp', 'confirmacao', 'propostas']
  LOOP
    SELECT ps.stage_key, ps.id INTO v_stage_key, v_system_stage
    FROM public.pipelines p
    JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
    WHERE p.organization_id = ctx.organization_id
      AND p.type = 'system' -- metric-lint-allow: fixture operacional, não métrica
      AND p.slug = v_slug
    ORDER BY ps.position, ps.id
    LIMIT 1;

    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => ctx.organization_id,
      p_slug => v_slug,
      p_lead_id => v_lead,
      p_stage_key => v_stage_key);
  END LOOP;

  SELECT pe.id INTO v_system_entry
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id
  WHERE pe.lead_id = v_lead AND p.slug = 'whatsapp'
  LIMIT 1;
  v_custom_entry := public.fn_entrada_custom_criar(
    p_organization_id => ctx.organization_id,
    p_pipeline_id => ctx.pipeline_id,
    p_lead_id => v_lead,
    p_stage_id => ctx.stage_id);

  BEGIN
    PERFORM public.fn_entrada_custom_atualizar(v_system_entry, '{}'::jsonb);
    RAISE EXCEPTION 'sentinela_custom_aceitou_system';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sentinela_custom_aceitou_system'
       OR strpos(SQLERRM, 'não pertence a funil custom') = 0 THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.fn_entrada_sistema_atualizar(v_custom_entry, '{}'::jsonb);
    RAISE EXCEPTION 'sentinela_system_aceitou_custom';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sentinela_system_aceitou_custom'
       OR strpos(SQLERRM, 'não pertence a funil de sistema') = 0 THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.fn_etapa_custom_atualizar(v_system_stage, '{}'::jsonb);
    RAISE EXCEPTION 'sentinela_etapa_custom_aceitou_system';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sentinela_etapa_custom_aceitou_system'
       OR strpos(SQLERRM, 'não pertence a funil custom') = 0 THEN
      RAISE;
    END IF;
  END;

  UPDATE public.leads
     SET pre_sale_responsible_id = ctx.actor_id,
         sale_responsible_id = ctx.actor_id,
         compromisso_date = '2026-09-09 15:00:00+00'
   WHERE id = v_lead;

  IF (
    SELECT count(*)
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
    WHERE pe.lead_id = v_lead
      AND p.slug IN ('whatsapp', 'confirmacao', 'propostas')
      AND NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid = ctx.actor_id
      AND NULLIF(pe.metadata->>'sale_responsible_id', '')::uuid = ctx.actor_id
  ) <> 3 THEN
    RAISE EXCEPTION 'REPROVOU: trigger de lead não projetou o par de responsáveis';
  END IF;

  IF (
    SELECT pe.metadata->>'meeting_date'
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
    WHERE pe.lead_id = v_lead AND p.slug = 'confirmacao'
  ) IS DISTINCT FROM '2026-09-09T15:00:00+00:00'
     AND (
       SELECT pe.metadata->>'meeting_date'
       FROM public.pipeline_entries pe
       JOIN public.pipelines p ON p.id = pe.pipeline_id
       WHERE pe.lead_id = v_lead AND p.slug = 'confirmacao'
     ) IS DISTINCT FROM '2026-09-09 15:00:00+00' THEN
    RAISE EXCEPTION 'REPROVOU: compromisso não virou meeting_date';
  END IF;

  UPDATE public.leads
     SET pre_sale_responsible_id = null, sale_responsible_id = null
   WHERE id = v_lead;
  IF EXISTS (
    SELECT 1
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
    WHERE pe.lead_id = v_lead
      AND p.slug IN ('whatsapp', 'confirmacao', 'propostas')
      AND (
        NOT pe.metadata ? 'pre_sale_responsible_id'
        OR jsonb_typeof(pe.metadata->'pre_sale_responsible_id') IS DISTINCT FROM 'null'
        OR NOT pe.metadata ? 'sale_responsible_id'
        OR jsonb_typeof(pe.metadata->'sale_responsible_id') IS DISTINCT FROM 'null')
  ) THEN
    RAISE EXCEPTION 'REPROVOU: desatribuição não preservou nulo explícito';
  END IF;

  v_poison := jsonb_set(v_pipeline_after, '{color}', '"#000000"');
  IF md5(ctx.pipeline_before::text) IS NOT DISTINCT FROM md5(v_poison::text) THEN
    RAISE EXCEPTION 'REPROVOU: controle positivo não detectou divergência';
  END IF;

  RAISE NOTICE 'ENSAIO_OK SCRUM-673: funil/etapa A/B idênticos, triggers delegam, ACL fechada, atomicidade e controle positivo OK';
END;
$$;

ROLLBACK;
